// What the band reads off a session's transcript, which Claude Code keeps:
// where it is, its last main-loop reply, the rate its cost record solves to,
// how long its cache was last written for, and what the session had spent.
// Every line is untrusted data, parsed on its own.

import type { Spend, Ttl } from './cache'
import { NO_TOKENS, addTokens, modelName, tierFactor, weightedTokens } from './prices'
import type { TokenCounts } from './prices'
import { stripTrailingSlashes } from './workspace'

/** Whether a parsed value is an object, as a store entry or a transcript line must be. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Where Claude Code keeps a session's transcript: its project folder named
 *  for the project root, every character but a letter or digit a dash. */
export const transcriptPath = (home: string, root: string, id: string): string =>
  `${stripTrailingSlashes(home)}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`

/** The most a mod may read in one go; a larger transcript stays unread. */
export const READ_LIMIT = 4 * 1024 * 1024

const parsed = (line: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(line)
    return isRecord(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** A transcript's lines from its end, parsed, the ones that name `marker`:
 *  a cheap text test first, so most lines are never parsed. */
function* fromEnd(transcript: string, marker: string): Generator<Record<string, unknown>> {
  const lines = transcript.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.includes(marker)) continue
    const entry = parsed(line)
    if (entry !== undefined) yield entry
  }
}

/** What marks a reply's line. */
const REPLY_MARKER = '"assistant"'

/** The model Claude Code names a reply it wrote itself, sent to no API. */
const SYNTHETIC_MODEL = '<synthetic>'

/** Whether a transcript line is a main-loop reply: a subagent's says nothing
 *  of the main loop's cache, its model or its prompt, and nor does one
 *  Claude Code wrote itself, an API error's (a limit hit, no connection) or
 *  a turn it answered without asking, which read and wrote no cache. */
const isMainReply = (entry: Record<string, unknown>): boolean =>
  entry.type === 'assistant' &&
  entry.isSidechain !== true &&
  entry.isApiErrorMessage !== true &&
  !(isRecord(entry.message) && entry.message.model === SYNTHETIC_MODEL)

/** When a transcript line was logged; undefined where it doesn't say. */
const loggedAt = (entry: Record<string, unknown>): number | undefined => {
  const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  return Number.isFinite(at) ? at : undefined
}

/** When a transcript's last main-loop reply was. Its file time won't do:
 *  Claude Code writes a cost line each time it opens a session. */
export const lastReplyAt = (transcript: string): number | undefined => {
  for (const entry of fromEnd(transcript, REPLY_MARKER)) {
    const at = isMainReply(entry) ? loggedAt(entry) : undefined
    if (at !== undefined) return at
  }
  return undefined
}

/** The model the transcript's last main-loop reply was billed under, as the API names it. */
export const lastReplyModel = (transcript: string): string | undefined => {
  for (const entry of fromEnd(transcript, REPLY_MARKER)) {
    if (!isMainReply(entry) || !isRecord(entry.message)) continue
    const model = entry.message.model
    if (typeof model === 'string' && model !== '') return model
  }
  return undefined
}

/** A count the transcript gives, or 0 for anything that isn't one. */
const countOf = (record: Record<string, unknown>, key: string): number => {
  const v = record[key]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** One model's tokens in a cost record. The record doesn't split its writes
 *  by lifetime, so they count as five minutes'. */
const recordTokens = (m: Record<string, unknown>): TokenCounts => ({
  uncached: countOf(m, 'inputTokens'),
  written: countOf(m, 'cacheCreationInputTokens'),
  writtenHour: 0,
  read: countOf(m, 'cacheReadInputTokens'),
  output: countOf(m, 'outputTokens'),
})

/** One reply's tokens, as the API reports its usage: its writes split by
 *  lifetime where it logs the split, else five minutes'. */
const replyTokens = (usage: Record<string, unknown>): TokenCounts => ({
  uncached: countOf(usage, 'input_tokens'),
  written: countOf(usage, 'cache_creation_input_tokens'),
  writtenHour: Math.min(
    countOf(usage, 'cache_creation_input_tokens'),
    isRecord(usage.cache_creation) ? countOf(usage.cache_creation, 'ephemeral_1h_input_tokens') : 0,
  ),
  read: countOf(usage, 'cache_read_input_tokens'),
  output: countOf(usage, 'output_tokens'),
})

/** The base rate per token a cost record's entry for `model` solves to: its
 *  dollars over its weighted tokens. */
const recordRate = (m: Record<string, unknown>, model: string): number | null => {
  const weighted = weightedTokens(recordTokens(m), model)
  const rate = weighted > 0 ? countOf(m, 'costUSD') / weighted : 0
  return rate > 0 ? rate : null
}

/** What marks a cost record's line, for `grep -F` to find. */
export const COST_RECORD = '"type":"cost-state"'

/** The prompt the transcript's last main-loop reply sent: every input
 *  token, cache reads and writes included, as a price tier counts it. */
const lastPrompt = (transcript: string): number | undefined => {
  for (const entry of fromEnd(transcript, REPLY_MARKER)) {
    if (!isMainReply(entry) || !isRecord(entry.message) || !isRecord(entry.message.usage)) continue
    const t = replyTokens(entry.message.usage)
    return t.uncached + t.read + t.written
  }
  return undefined
}

/** The base rate per token on `model`, solved from the transcript's last
 *  cost record. The record can't say which requests passed a price tier, so
 *  on a model with two the last reply's prompt stands for them all. */
export const rateFromTranscript = (transcript: string, model: string): number | null => {
  for (const entry of fromEnd(transcript, COST_RECORD)) {
    if (entry.type !== 'cost-state') continue
    const usage = entry.modelUsage
    const m = isRecord(usage) ? usage[modelName(model)] : undefined
    const rate = isRecord(m) ? recordRate(m, model) : null
    return rate === null ? null : rate / tierFactor(model, lastPrompt(transcript) ?? 0)
  }
  return null
}

/** What marks a line whose usage splits its cache writes by lifetime. */
const CACHE_WRITE_MARKER = '"cache_creation"'

/** The transcript's last main-loop cache write: the TTL it was made at, an
 *  hour if it wrote any for an hour, else five minutes if it wrote any, and
 *  when its line was logged. */
export const lastWrite = (transcript: string): Readonly<{ ttl: Ttl; at: number | undefined }> | undefined => {
  for (const entry of fromEnd(transcript, CACHE_WRITE_MARKER)) {
    if (!isMainReply(entry) || !isRecord(entry.message)) continue
    const usage = entry.message.usage
    const written = isRecord(usage) ? usage.cache_creation : undefined
    if (!isRecord(written)) continue
    if (countOf(written, 'ephemeral_1h_input_tokens') > 0) return { ttl: '1h', at: loggedAt(entry) }
    if (countOf(written, 'ephemeral_5m_input_tokens') > 0) return { ttl: '5m', at: loggedAt(entry) }
  }
  return undefined
}

/** The TTL the transcript's last main-loop cache write was made at. */
export const lastWriteTtl = (transcript: string): Ttl | undefined => lastWrite(transcript)?.ttl

/** A line's cost record, parsed; undefined for any other line, or one cut short. */
const costRecordOf = (line: string): Record<string, unknown> | undefined => {
  if (!line.includes(COST_RECORD)) return undefined
  const entry = parsed(line)
  return entry?.type === 'cost-state' ? entry : undefined
}

/** Which of `records` a session's spend counts from: its own last one, else
 *  the last of any session's, as a fork's file may hold only its parent's.
 *  -1 with none. */
const recordFor = (records: ReadonlyArray<Record<string, unknown> | undefined>, sessionId: string): number => {
  const own = records.findLastIndex(record => record?.sessionId === sessionId)
  return own >= 0 ? own : records.findLastIndex(record => record !== undefined)
}

/** The cost record `sessionId`'s spend counts from, in `grep -b` output: the
 *  byte offset grep gives it (where its line starts, or with ugrep where the
 *  match does), and the line. */
export const sessionCostRecord = (found: string, sessionId: string): Readonly<{ offset: number; line: string }> | undefined => {
  const hits = found.split('\n').flatMap(text => {
    const [, offset, line] = /^(\d+):(.*)$/.exec(text) ?? []
    return offset === undefined || line === undefined ? [] : [{ offset: Number(offset), line }]
  })
  return hits[recordFor(hits.map(hit => costRecordOf(hit.line)), sessionId)]
}

/** What `sessionId`'s conversation had spent by `before`, off `transcript`:
 *  its cost record's dollars and every model's tokens in it, then each reply
 *  logged after that record and before `before`, priced at its model's rate
 *  there (a model the record doesn't name adds its tokens alone). A reply
 *  logged since is this process's own, which its ledger counts. Claude Code
 *  logs a reply once per content block, each line with the same usage, so a
 *  reply counts once by its id. Undefined without a well-formed record. */
export const transcriptSpend = (transcript: string, sessionId: string, before: number): Spend | undefined => {
  const lines = transcript.split('\n')
  const records = lines.map(costRecordOf)
  const at = recordFor(records, sessionId)
  const record = records[at]
  if (record === undefined) return undefined
  const models = isRecord(record.modelUsage) ? record.modelUsage : {}
  let usd = countOf(record, 'totalCostUSD')
  let tokens = Object.values(models).filter(isRecord).map(recordTokens).reduce(addTokens, NO_TOKENS)
  const counted = new Set<string>()
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.includes(REPLY_MARKER)) continue
    const entry = parsed(line)
    if (entry?.type !== 'assistant' || (loggedAt(entry) ?? -Infinity) >= before) continue
    const message = isRecord(entry.message) ? entry.message : undefined
    if (message === undefined || typeof message.id !== 'string' || counted.has(message.id) || !isRecord(message.usage)) continue
    counted.add(message.id)
    const reply = replyTokens(message.usage)
    tokens = addTokens(tokens, reply)
    const model = typeof message.model === 'string' ? message.model : undefined
    const priced = model === undefined ? undefined : models[modelName(model)]
    const rate = model !== undefined && isRecord(priced) ? recordRate(priced, model) : null
    if (rate !== null) usd += rate * weightedTokens(reply, model)
  }
  return { usd, tokens }
}
