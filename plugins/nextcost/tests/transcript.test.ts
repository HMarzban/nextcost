// What the band reads off a session's transcript: where it lives, its last
// main-loop reply and that reply's model, the rate its cost record solves to,
// how long its cache was last written for, the cost record grep found for a
// session, and what the session had spent. Every line is untrusted data.

import { test, expect } from 'claude-code/testing'
import {
  COST_RECORD,
  isRecord,
  lastRequestAt,
  lastReplyModel,
  lastWrite,
  lastWriteTtl,
  rateFromTranscript,
  sessionCostRecord,
  transcriptPath,
  transcriptSpend,
} from '../hooks/transcript'
import { costRecord, jsonl, promptLine, rateNear, replyLine, requestLines } from './helpers'

const iso = (ms: number): string => new Date(ms).toISOString()
/** A Haiku 5.5 reply whose request sent `prompt` input tokens. */
const haikuReply = (prompt: number) => ({
  type: 'assistant',
  timestamp: iso(1_000),
  message: { role: 'assistant', model: 'claude-haiku-5-5', content: [], usage: { input_tokens: 1_000, cache_read_input_tokens: prompt - 1_000, cache_creation_input_tokens: 0, output_tokens: 500 } },
})

// ── where a transcript lives ───────────────────────────────────────────

test("a transcript lives under home's projects, in a folder named for the root with every other character a dash", () => {
  expect(transcriptPath('/Users/me', '/Users/me/workspace/nextcost', 's1')).toBe('/Users/me/.claude/projects/-Users-me-workspace-nextcost/s1.jsonl')
  expect(transcriptPath('/Users/me', '/Users/me/my.proj_x 2', 's1')).toBe('/Users/me/.claude/projects/-Users-me-my-proj-x-2/s1.jsonl')
})

test("home's trailing slashes are trimmed", () => {
  expect(transcriptPath('/Users/me/', '/p', 's1')).toBe('/Users/me/.claude/projects/-p/s1.jsonl')
  expect(transcriptPath('/Users/me//', '/p', 's1')).toBe('/Users/me/.claude/projects/-p/s1.jsonl')
})

// ── the last request ───────────────────────────────────────────────────

test('a lifetime runs from the request: the last reply\'s time is that of the prompt before it', () => {
  // A 3-minute generation.
  expect(lastRequestAt(jsonl(promptLine(1_000), replyLine(181_000)))).toBe(1_000)
})

test('in a tool loop, the request is the one after the last tool result', () => {
  expect(lastRequestAt(jsonl(promptLine(1_000), replyLine(2_000), promptLine(3_000), replyLine(90_000)))).toBe(3_000)
})

test('a reply logged a line per block goes back past its own lines; a subagent\'s prompt is no request of this loop', () => {
  const sidechain = { ...promptLine(50_000), isSidechain: true }
  expect(lastRequestAt(jsonl(promptLine(1_000), replyLine(2_000), sidechain, replyLine(3_000)))).toBe(1_000)
})

test("with no line before it to go by, the last request is the last reply's time, past the lines Claude Code adds after it", () => {
  const transcript = jsonl(replyLine(5_000), { type: 'last-prompt', lastPrompt: 'hi' }, { type: 'cost-state', totalCostUSD: 1, modelUsage: {} })
  expect(lastRequestAt(transcript)).toBe(5_000)
})

test('the last reply is the last in the file, not the latest time in it', () => {
  expect(lastRequestAt(jsonl(replyLine(9_000), replyLine(2_000)))).toBe(2_000)
})

test('lines that are not assistant replies, even ones naming "assistant", are skipped', () => {
  const transcript = jsonl(replyLine(5_000), promptLine(9_000), { type: 'last-prompt', lastPrompt: 'assistant' })
  expect(lastRequestAt(transcript)).toBe(5_000)
})

/** A reply Claude Code wrote itself, sent nowhere: an API error such as a
 *  limit hit, or a turn it answered without asking (`No response requested.`). */
const syntheticLine = (ms: number, isApiErrorMessage: boolean) => ({
  type: 'assistant',
  timestamp: iso(ms),
  isApiErrorMessage,
  message: { role: 'assistant', model: '<synthetic>', content: [], usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } },
})

test("a reply Claude Code wrote itself, an error's or one it sent nowhere, is no last reply", () => {
  const transcript = jsonl(replyLine(5_000), syntheticLine(9_000, true), syntheticLine(12_000, false))
  expect(lastRequestAt(transcript)).toBe(5_000)
  expect(lastReplyModel(transcript)).toBe('claude-opus-5-5')
})

test("an error that names a real model is still no last reply", () => {
  const error = { ...syntheticLine(9_000, true), message: { ...syntheticLine(9_000, true).message, model: 'claude-opus-5-5' } }
  expect(lastRequestAt(jsonl(replyLine(5_000), error))).toBe(5_000)
})

test('an unparseable line, or a reply with no readable time, is skipped', () => {
  const transcript = jsonl(replyLine(5_000), '{"type":"assistant", "timestamp": broken', { type: 'assistant', timestamp: 'not a time' }, { type: 'assistant', timestamp: 7_000 })
  expect(lastRequestAt(transcript)).toBe(5_000)
})

test("the last reply's model is the one the API billed it under, past lines that name none", () => {
  const sonnet = { ...replyLine(1_000), message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [] } }
  expect(lastReplyModel(jsonl(sonnet, replyLine(2_000), promptLine(3_000), { type: 'assistant', timestamp: iso(4_000), message: { role: 'assistant' } }))).toBe('claude-opus-5-5')
  expect(lastReplyModel(jsonl(promptLine(1_000)))).toBeUndefined()
})

test("a subagent's reply is not the conversation's last: its own cache says nothing of the main loop's", () => {
  const subagent = { ...replyLine(9_000), isSidechain: true }
  expect(lastRequestAt(jsonl(replyLine(5_000), subagent))).toBe(5_000)
})

test("a subagent's reply names neither the main loop's model nor its last prompt", () => {
  const subagent = { ...haikuReply(150_000), timestamp: iso(9_000), isSidechain: true }
  expect(lastReplyModel(jsonl(replyLine(5_000), subagent))).toBe('claude-opus-5-5')
  // A subagent's prompt over Haiku's tier says nothing of the main loop's: the record counts at the lower tier.
  const transcript = jsonl(costRecord('claude-haiku-5-5'), haikuReply(60_000), subagent)
  expect(rateNear(rateFromTranscript(transcript, 'claude-haiku-5-5'), 20 / 4_000_000)).toBe(true)
})

test('a transcript with no reply has no last reply', () => {
  expect(lastRequestAt('')).toBeUndefined()
  expect(lastRequestAt(jsonl(promptLine(1_000)))).toBeUndefined()
})

// ── the rate ───────────────────────────────────────────────────────────

test("the rate is the cost record's dollars over its weighted tokens, reads at Opus 5.5's 0.05×", () => {
  // 1M + 1.25 × 400k + 0.05 × 20M + 5 × 100k = 3M weighted tokens
  expect(rateNear(rateFromTranscript(jsonl(costRecord('claude-opus-5-5')), 'claude-opus-5-5'), 20 / 3_000_000)).toBe(true)
})

test('on a model without a read price of its own, reads weigh 0.1×', () => {
  // Sonnet 5 reads at $0.20 on $2 input. 1M + 1.25 × 400k + 0.1 × 20M + 5 × 100k = 4M weighted tokens
  expect(rateNear(rateFromTranscript(jsonl(costRecord('claude-sonnet-5')), 'claude-sonnet-5'), 20 / 4_000_000)).toBe(true)
})

test("Sonnet 5.5 reads its cache at 0.05×, as Anthropic's pricing lists it ($0.10 on $2 input)", () => {
  // 1M + 1.25 × 400k + 0.05 × 20M + 5 × 100k = 3M weighted tokens
  expect(rateNear(rateFromTranscript(jsonl(costRecord('claude-sonnet-5-5')), 'claude-sonnet-5-5'), 20 / 3_000_000)).toBe(true)
})

test('on Haiku 5.5, a session whose last prompt was over 100k counts its cost record at the upper tier, 5×', () => {
  // 1M + 1.25 × 400k + 0.1 × 20M + 5 × 100k = 4M weighted tokens, at 5× the lower tier's rate
  const transcript = jsonl(costRecord('claude-haiku-5-5'), haikuReply(150_000))
  expect(rateNear(rateFromTranscript(transcript, 'claude-haiku-5-5'), 20 / 4_000_000 / 5)).toBe(true)
})

test('on Haiku 5.5, a session whose last prompt was under 100k counts its cost record at the lower tier', () => {
  const transcript = jsonl(costRecord('claude-haiku-5-5'), haikuReply(60_000))
  expect(rateNear(rateFromTranscript(transcript, 'claude-haiku-5-5'), 20 / 4_000_000)).toBe(true)
})

test('the last cost record is the one read', () => {
  const earlier = { ...costRecord(), modelUsage: { 'claude-opus-5-5': { inputTokens: 3_000_000, costUSD: 30 } } }
  const transcript = jsonl(earlier, replyLine(1_000), costRecord('claude-opus-5-5'))
  expect(rateNear(rateFromTranscript(transcript, 'claude-opus-5-5'), 20 / 3_000_000)).toBe(true)
})

test('a model the last cost record does not name has no rate, whatever an earlier record says', () => {
  expect(rateFromTranscript(jsonl(costRecord('claude-sonnet-5-5')), 'claude-opus-5-5')).toBeNull()
  expect(rateFromTranscript(jsonl(costRecord('claude-opus-5-5'), costRecord('claude-sonnet-5-5')), 'claude-opus-5-5')).toBeNull()
})

test('a model named with its context size finds its cost record, which names the model alone', () => {
  expect(rateNear(rateFromTranscript(jsonl(costRecord('claude-opus-5-5')), 'claude-opus-5-5[1m]'), 20 / 3_000_000)).toBe(true)
})

test('no cost record, nothing spent or nothing counted is no rate', () => {
  expect(rateFromTranscript(jsonl(promptLine(1_000), replyLine(2_000)), 'claude-opus-5-5')).toBeNull()
  expect(rateFromTranscript(jsonl({ type: 'cost-state', modelUsage: { 'claude-opus-5-5': { inputTokens: 1_000, costUSD: 0 } } }), 'claude-opus-5-5')).toBeNull()
  expect(rateFromTranscript(jsonl({ type: 'cost-state', modelUsage: { 'claude-opus-5-5': { costUSD: 3 } } }), 'claude-opus-5-5')).toBeNull()
})

test('a later line that merely names cost-state, such as a prompt quoting it, never hides the real record', () => {
  const transcript = jsonl(costRecord('claude-opus-5-5'), { type: 'last-prompt', lastPrompt: 'cost-state' })
  expect(rateNear(rateFromTranscript(transcript, 'claude-opus-5-5'), 20 / 3_000_000)).toBe(true)
})

test('an unreadable last cost line falls back to the record before it', () => {
  const transcript = jsonl(costRecord('claude-opus-5-5'), '{"type":"cost-state", broken')
  expect(rateNear(rateFromTranscript(transcript, 'claude-opus-5-5'), 20 / 3_000_000)).toBe(true)
})

/** A cost record of 100k written and $1, `m` laid over its Opus 5.5 usage. */
const writesRecord = (m: Record<string, unknown>): string =>
  JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: 1, modelUsage: { 'claude-opus-5-5': { costUSD: 1, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 100_000, ...m } } })

test("a cost record that splits its writes by lifetime is solved at each's price; one that doesn't, as five minutes'", () => {
  // $1 on 100k written: at the hour's 2×, $5 per million; at 1.25×, $8.
  const split = writesRecord({ cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: 100_000 })
  expect(Math.abs((rateFromTranscript(split, 'claude-opus-5-5') ?? 0) - 5e-6) < 1e-12).toBe(true)
  expect(Math.abs((rateFromTranscript(writesRecord({}), 'claude-opus-5-5') ?? 0) - 8e-6) < 1e-12).toBe(true)
  expect(transcriptSpend(split, 's1', 0)?.tokens.writtenHour).toBe(100_000)
  expect(transcriptSpend(writesRecord({}), 's1', 0)?.tokens.writtenHour).toBe(0)
})

// ── the cache's last write ─────────────────────────────────────────────

test("the cache's last write says its TTL: an hour if it wrote any for an hour, else five minutes", () => {
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '1h': 100 } })))).toBe('1h')
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '1h': 100, '5m': 50 } })))).toBe('1h')
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '5m': 50 } })))).toBe('5m')
  // The last write that wrote anything is the one read.
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '1h': 100 } }), replyLine(1_000, { wrote: { '5m': 50 } })))).toBe('5m')
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '5m': 50 } }), replyLine(1_000, { wrote: { '5m': 0, '1h': 0 } })))).toBe('5m')
})

test("a subagent's write says nothing of the main loop's cache, and no write is no TTL", () => {
  expect(lastWriteTtl(jsonl(replyLine(1_000, { wrote: { '5m': 50 } }), { ...replyLine(1_000, { wrote: { '1h': 100 } }), isSidechain: true }))).toBe('5m')
  expect(lastWriteTtl(jsonl(replyLine(1_000), promptLine(2_000)))).toBeUndefined()
  expect(lastWriteTtl('')).toBeUndefined()
})

// ── a transcript with the request's blobs in it ─────────────────────────

test("a request's megabyte blobs, an assistant's among them, are not replies: the reply, its model, its write and the rate read past them", () => {
  const reply = replyLine(2_000, { wrote: { '1h': 100 } })
  const transcript = jsonl(promptLine(1_000), ...requestLines(1_500, 2 * 1024 * 1024), reply, { type: 'last-prompt', lastPrompt: 'hi' }, ...requestLines(9_000, 2 * 1024 * 1024), costRecord('claude-opus-5-5'))
  expect(transcript.length).toBeGreaterThan(4 * 1024 * 1024)
  expect(lastRequestAt(transcript)).toBe(1_000)
  expect(lastReplyModel(transcript)).toBe('claude-opus-5-5')
  expect(lastWrite(transcript)).toEqual({ ttl: '1h', at: 2_000 })
  expect(rateNear(rateFromTranscript(transcript, 'claude-opus-5-5'), 20 / 3_000_000)).toBe(true)
})

// ── the cost record grep found ─────────────────────────────────────────

/** A cost record of `sessionId`'s, as one line. */
const recordOf = (sessionId: string): string => JSON.stringify({ ...costRecord('claude-opus-5-5'), sessionId })
/** `grep -b`'s output: each line after its byte offset. */
const found = (...hits: ReadonlyArray<readonly [number, string]>): string => hits.map(([offset, line]) => `${offset}:${line}`).join('\n') + '\n'

test("the cost record a session's spend counts from is its own last one, with grep's offset", () => {
  const out = found([12, recordOf('s1')], [400, recordOf('s2')], [900, recordOf('s1')], [1400, recordOf('s2')])
  expect(sessionCostRecord(out, 's1')).toEqual({ offset: 900, line: recordOf('s1') })
  expect(sessionCostRecord(out, 's2')).toEqual({ offset: 1400, line: recordOf('s2') })
})

test("a fork's file holds only its parent's records, so the last of any session's stands for its own", () => {
  expect(sessionCostRecord(found([12, recordOf('parent')], [400, recordOf('parent')]), 'fork')).toEqual({ offset: 400, line: recordOf('parent') })
})

test('a line that only names a cost record, or is cut short, is none, and with none there is none', () => {
  const quoting = JSON.stringify({ type: 'user', note: JSON.parse(`{${COST_RECORD}}`) as unknown })
  expect(quoting).toContain(COST_RECORD)
  expect(sessionCostRecord(found([12, recordOf('s1')], [400, quoting], [800, '{"type":"cost-state", broken']), 's2')).toEqual({ offset: 12, line: recordOf('s1') })
  expect(sessionCostRecord(found([12, quoting]), 's1')).toBeUndefined()
  expect(sessionCostRecord('', 's1')).toBeUndefined()
  expect(sessionCostRecord('not grep output', 's1')).toBeUndefined()
})

// ── what a session had spent ───────────────────────────────────────────

/** A reply logged at `ms`, its id `id`, billed under `model` for `input`
 *  uncached tokens and nothing else. */
const billed = (ms: number, id: string, input: number, model = 'claude-opus-5-5') => ({
  type: 'assistant',
  timestamp: iso(ms),
  message: { id, role: 'assistant', model, content: [], usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
})
/** costRecord's tokens for one model, as the spend counts them. */
const RECORD_TOKENS = { uncached: 1_000_000, written: 400_000, writtenHour: 0, read: 20_000_000, output: 100_000 }

test("a session's spend is its cost record's dollars and tokens", () => {
  expect(transcriptSpend(jsonl({ ...costRecord('claude-opus-5-5'), sessionId: 's1' }), 's1', Infinity)).toEqual({ usd: 20, tokens: RECORD_TOKENS })
})

test('each reply logged after the record and before the cut adds its tokens, priced at its model\'s rate there', () => {
  // The record solves to $20 over 3M weighted tokens: 3,000 uncached tokens are $0.02.
  const transcript = jsonl({ ...costRecord('claude-opus-5-5'), sessionId: 's1' }, billed(1_000, 'm1', 3_000), billed(5_000, 'm2', 6_000))
  const spend = transcriptSpend(transcript, 's1', 5_000)
  expect(spend?.tokens).toEqual({ ...RECORD_TOKENS, uncached: 1_003_000 })
  expect(Math.abs((spend?.usd ?? 0) - 20.02)).toBeLessThan(1e-9)
})

test("a reply's hour-long cache write is priced at 2×, by the split its usage logs", () => {
  // The record solves to $20 over 3M weighted tokens (its writes unsplit, at
  // 1.25×); 4,000 tokens written for an hour weigh 8,000: $0.0533.
  const hour = replyLine(1_000, { wrote: { '1h': 4_000 } })
  const spend = transcriptSpend(jsonl({ ...costRecord('claude-opus-5-5'), sessionId: 's1' }, hour), 's1', Infinity)
  expect(spend?.tokens).toEqual({ ...RECORD_TOKENS, written: 404_000, writtenHour: 4_000 })
  expect(Math.abs((spend?.usd ?? 0) - (20 + 8_000 / 150_000))).toBeLessThan(1e-9)
})

test('a reply logged once per content block counts once, by its id', () => {
  const transcript = jsonl({ ...costRecord('claude-opus-5-5'), sessionId: 's1' }, billed(1_000, 'm1', 3_000), billed(1_000, 'm1', 3_000))
  expect(transcriptSpend(transcript, 's1', Infinity)?.tokens.uncached).toBe(1_003_000)
})

test('a reply on a model the record does not name adds its tokens alone', () => {
  const transcript = jsonl({ ...costRecord('claude-opus-5-5'), sessionId: 's1' }, billed(1_000, 'm1', 3_000, 'claude-sonnet-5-5'))
  expect(transcriptSpend(transcript, 's1', Infinity)).toEqual({ usd: 20, tokens: { ...RECORD_TOKENS, uncached: 1_003_000 } })
})

test("the spend counts from the session's own last record, else the last of any session's", () => {
  const other = { ...costRecord('claude-opus-5-5'), sessionId: 's2', totalCostUSD: 7 }
  const own = { ...costRecord('claude-opus-5-5'), sessionId: 's1' }
  expect(transcriptSpend(jsonl(own, other), 's1', Infinity)?.usd).toBe(20)
  expect(transcriptSpend(jsonl(own, other), 'fork', Infinity)?.usd).toBe(7)
})

test('without a well-formed cost record there is no spend', () => {
  expect(transcriptSpend(jsonl(promptLine(1_000), billed(2_000, 'm1', 3_000)), 's1', Infinity)).toBeUndefined()
  expect(transcriptSpend(jsonl('{"type":"cost-state", broken'), 's1', Infinity)).toBeUndefined()
  expect(transcriptSpend('', 's1', Infinity)).toBeUndefined()
})

test('a record is an object, never null, an array or a value', () => {
  expect([{}, { a: 1 }].map(isRecord)).toEqual([true, true])
  expect([null, [], 'x', 3, undefined].map(isRecord)).toEqual([false, false, false, false, false])
})
