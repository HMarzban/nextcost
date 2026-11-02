import { test, expect } from 'claude-code/testing'
import { fixedZone, fmtClock } from '../hooks/format'
import { cappedMarks } from '../hooks/calendar'
import { readingsOf } from '../hooks/reading'
import { HOUR, MIN, SAMPLES, expectNear } from './helpers'
import { NO_HISTORY, snapOf } from './matrix'

const cacheAt = (leftMs: number) => ({ ...snapOf().cache, leftMs })

test('readings name every limit with its tone, value, reset and projection', () => {
  const r = readingsOf(snapOf())
  expect(r.fiveHour?.tone).toBe('calm')
  expect(r.fiveHour?.value).toBe('4%')
  expect(r.fiveHour?.reset).toEqual({ kind: 'in', text: '3h 00m' })
  expectNear(r.sevenDay?.projectedPct, 30 / (1 - 67 / 168), 1e-5)
  expect(r.worstLimit?.name).toBe('7d')
  expect(r.limits.map(l => l.name)).toEqual(['5h', '7d'])
})
test("a card says each limit's reset with its pace", () => {
  expect(readingsOf(snapOf()).limits.map(l => l.resetAndPace)).toEqual(['resets 3h 00m · ~10% at avg pace', 'resets 2d 19h · ~50% at avg pace'])
})
test('a card says when a limit resets: its clock once the offset is known, else how long until; nothing once passed', () => {
  expect(readingsOf(snapOf({ zone: fixedZone(0) })).limits.map(l => l.resetWhen)).toEqual(['03:00', 'Sat 19:00'])
  expect(readingsOf(snapOf()).limits.map(l => l.resetWhen)).toEqual(['in 3h 00m', 'in 2d 19h'])
  expect(readingsOf(snapOf({ now: 4 * HOUR })).fiveHour?.resetWhen).toBeUndefined()
})
test('a window that fills before its reset says when: a measured fill, else the average pace\'s, its day past today', () => {
  // 7d at 66% with 30h of 168 gone fills in another 30h × 34/66, 15h 27m:
  // from Sunday 20:00, Monday; from Sunday midnight, that day at 15:27.
  const sevenFrom = (now: number) => readingsOf(snapOf({ zone: fixedZone(0), now, sevenDay: { percentUsed: 66, resetsAt: now + 138 * HOUR } })).sevenDay
  const seven = sevenFrom(3 * 24 * HOUR + 20 * HOUR)
  expectNear(seven?.fillInMs, (30 * HOUR * 34) / 66, 1e-3)
  expect(seven?.fillText).toBe('full ~Mon at avg pace')
  expect(sevenFrom(3 * 24 * HOUR)?.fillText).toBe('full ~15:30 at avg pace')
  expect(readingsOf(snapOf({ sevenDay: { percentUsed: 66, resetsAt: 138 * HOUR } })).sevenDay?.fillText).toBe('full in ~15h 30m at avg pace')
  // Measured, the 5h's own fill.
  expect(readingsOf(snapOf({ zone: fixedZone(0), fiveHour: { percentUsed: 40, resetsAt: 3 * HOUR, etaMs: 40 * MIN } })).fiveHour?.fillText).toBe('full ~00:40')
  expect(readingsOf(snapOf({ zone: fixedZone(0) })).fiveHour?.fillInMs).toBeUndefined()
})
test("a fill's clock is rounded as its ETA is: to 5 minutes under an hour, 15 from one, in the wall time it shows", () => {
  const now = Date.UTC(2026, 9, 9, 13, 40)
  const filling = (etaMs: number, zone = fixedZone(0)) => readingsOf(snapOf({ now, zone, fiveHour: { percentUsed: 84, resetsAt: now + 4 * HOUR, etaMs } })).fiveHour
  // 14:23 is the minute the arithmetic gives; the ETA says ~45m, to 5 minutes.
  expect(filling(43 * MIN)?.fillText).toBe('full ~14:25')
  expect(filling(43 * MIN)?.fullIn).toBe('~45m')
  expect(filling(127 * MIN)?.fillText).toBe('full ~15:45') // 15:47
  expect(filling(70 * MIN)?.fillText).toBe('full ~14:45') // 14:50: its ETA, ~1h 15m, is to 15
  // At +5:30 the wall clock reads 19:10; its minutes round, not UTC's.
  expect(filling(43 * MIN, fixedZone(330))?.fillText).toBe('full ~19:55')
  expect(filling(117 * MIN, fixedZone(330))?.fillText).toBe('full ~21:00') // 21:07, to the quarter hour
  // Never a clock at or before now: 13:41 and a minute to go is 13:45, not 13:40.
  const soon = Date.UTC(2026, 9, 9, 13, 41)
  expect(readingsOf(snapOf({ now: soon, zone: fixedZone(0), fiveHour: { percentUsed: 84, resetsAt: soon + 4 * HOUR, etaMs: MIN } })).fiveHour?.fillText).toBe('full ~13:45')
})
test("an average over a young window is not a claim: the week needs a day of it, and its 12% in 9 hours says nothing of filling", () => {
  const seven = (hoursGone: number, percentUsed: number) =>
    readingsOf(snapOf({ zone: fixedZone(0), sevenDay: { percentUsed, resetsAt: (168 - hoursGone) * HOUR } })).sevenDay
  const thin = seven(9, 12) // 224% at the average, from nine hours
  expect([thin?.projectedPct, thin?.fillInMs, thin?.fillText, thin?.pace]).toEqual([undefined, undefined, undefined, ''])
  expect(seven(23, 12)?.projectedPct).toBeUndefined()
  expect(seven(25, 20)?.pace).toBe('full at avg pace')
  expect(seven(25, 5)?.pace).toBe('~34% at avg pace')
})
test("the 5h says it fills only by a measured pace: the window's average is not claimed while the pace is flat, absent or an hour stale", () => {
  const five = (percentUsed: number, etaMs: number | null) => readingsOf(snapOf({ zone: fixedZone(0), fiveHour: { percentUsed, resetsAt: 4 * HOUR, etaMs } })).fiveHour
  // 70% an hour in is 350% at the average, and no measured pace backs it.
  const idle = five(70, null)
  expect([idle?.projectedPct, idle?.fillInMs, idle?.fillText, idle?.pace, idle?.fullInMs]).toEqual([undefined, undefined, undefined, '', undefined])
  expect(idle?.alt).toBe('5h limit 70 percent used, fine')
  // Landing short says what it is: the window's average.
  expect(five(4, null)?.pace).toBe('~20% at avg pace')
  // Measured, the fill is the pace's own.
  expect([five(70, 40 * MIN)?.pace, five(70, 40 * MIN)?.fillText]).toEqual(['full in ~40m', 'full ~00:40'])
})
test("a pace from the window's average says so in words and in its alt, a measured one does not", () => {
  const seven = readingsOf(snapOf({ sevenDay: { percentUsed: 79, resetsAt: 50 * HOUR } })).sevenDay
  expect([seven?.pace, seven?.alt]).toEqual(['full at avg pace', "7d limit 79 percent used, fine, full before its reset, at the window's average pace"])
  const lands = readingsOf(snapOf()).sevenDay
  expect([lands?.pace, lands?.alt]).toEqual(['~50% at avg pace', "7d limit 30 percent used, fine, about 50 percent at its reset, at the window's average pace"])
  // The week's fill from its average says so beside its clock; a measured 5h fill has no such tail.
  const average = (zone: ReturnType<typeof fixedZone> | undefined) => readingsOf(snapOf({ zone, sevenDay: { percentUsed: 66, resetsAt: 138 * HOUR } })).sevenDay?.fillText
  expect([average(fixedZone(0)), average(undefined)]).toEqual(['full ~15:30 at avg pace', 'full in ~15h 30m at avg pace'])
})
test("the limits say they are as of the last reply, and how long ago once that is past a few minutes", () => {
  const seen = (ageMs: number | undefined) => readingsOf(snapOf({ limitsAt: ageMs === undefined ? undefined : -ageMs }))
  expect(seen(undefined).asOf).toBe('as of your last reply')
  expect(seen(4 * MIN).asOf).toBe('as of your last reply')
  expect(seen(5 * MIN).asOf).toBe('as of your last reply, 5m ago')
  expect(seen(125 * MIN).asOf).toBe('as of your last reply, 2h 05m ago')
  // A clock that ran back leaves no negative age.
  expect(readingsOf(snapOf({ limitsAt: 10 * MIN })).asOf).toBe('as of your last reply')
  expect(seen(125 * MIN).chips.limitHover).toEqual({
    '5h': "Resets in 3h 00m; 5-hour limit, all your Claude use; as of your last reply, 2h 05m ago",
    '7d': "Resets in 2d 19h; weekly limit, all your Claude use; as of your last reply, 2h 05m ago",
  })
  // With a pace the hover ends on the age, which is the least that a short row's cut may take.
  expect(readingsOf(snapOf({ fiveHour: { percentUsed: 40, resetsAt: 3 * HOUR, etaMs: 40 * MIN }, limitsAt: -7 * MIN })).chips.limitHover['5h']).toBe(
    'Resets in 3h 00m; 5-hour limit, all your Claude use; full in ~40m at the current pace; as of your last reply, 7m ago',
  )
  // Nothing to say of a window that has reset, or of none.
  expect(readingsOf(snapOf({ now: 4 * HOUR })).asOf).toBe('as of your last reply')
  expect(readingsOf(snapOf({ now: 70 * HOUR })).asOf).toBeUndefined()
  expect(readingsOf(snapOf({ fiveHour: undefined, sevenDay: undefined })).asOf).toBeUndefined()
})
test('a card says nothing of a window that has passed', () => {
  expect(readingsOf(snapOf({ now: 4 * HOUR })).fiveHour?.resetAndPace).toBeUndefined()
})
test('a card heads its section with one figure, the rest in words, in lowercase', () => {
  const r = readingsOf(snapOf())
  expect(r.cache.cardHead).toEqual([['52m', 'value'], [' left', 'label']])
  expect(r.context.cardHead).toEqual([['40%', 'value'], [' full', 'label']])
  const off = readingsOf(snapOf({ context: { tokens: 170_000, window: 200_000, percent: 85, compactAt: undefined, autoCompactOff: true } }))
  expect(off.context.cardHead).toEqual([['85%!', 'value'], [' full', 'label']]) // the mark rides on the figure
  const moods = [
    snapOf({ cache: { ...snapOf().cache, requests: 0, fresh: false } }),
    snapOf({ cache: { ...snapOf().cache, requests: 0, fresh: true } }),
    snapOf({ cache: cacheAt(0) }),
    snapOf({ isWorking: true }),
  ]
  expect(moods.map(m => readingsOf(m).cache.cardHead)).toEqual([[['not measured yet', 'value']], [['warming', 'value']], [['cold', 'value']], [['warm', 'value']]])
})
test('a limit at 82% reads 5h 82%, with no mark, and is amber', () => {
  const r = readingsOf(snapOf({ fiveHour: { percentUsed: 82, resetsAt: 3 * HOUR, etaMs: null } }))
  expect(`${r.fiveHour?.name} ${r.fiveHour?.value}`).toBe('5h 82%')
  expect(r.fiveHour?.tone).toBe('amber')
})
test('a measured 5h fill sets its projection to 100', () => {
  const r = readingsOf(snapOf({ fiveHour: { percentUsed: 84, resetsAt: 70 * MIN, etaMs: 40 * MIN } }))
  expect(r.fiveHour?.projectedPct).toBe(100)
  expect(r.fiveHour?.tone).toBe('amber')
  expect(r.fiveHour?.resetAndPace).toBe('resets 1h 10m · full in ~40m')
})
test('a gateway spend limit is a limit named spend', () => {
  const r = readingsOf(snapOf({ otherLimits: [{ kind: 'spend_limit', percentUsed: 92, resetsAt: undefined }] }))
  expect(r.limits.at(-1)?.name).toBe('spend')
  expect(r.limits.at(-1)?.key).toBe('other')
  expect(r.limits.at(-1)?.tone).toBe('amber')
})
test('the cache facts carry its mood, tone, charge and price', () => {
  const r = readingsOf(snapOf())
  expect(r.cache.mood).toBe('warm')
  expect(r.cache.tone).toBe('calm')
  expectNear(r.cache.charge, 52 / 60, 1e-5)
  expect(r.cache.estimate).toBe('~$1.66')
  expect(r.chips.cache.pill(false)).toBe('cache 52m')
  expect(r.spend.total).toBe(225_000)
})

test("chips' words say its hover cards and the context's amount", () => {
  const c = readingsOf(snapOf({ history: { costs: [{ usd: 0.21, reWarm: false }], context: [] } })).chips
  expect([c.costHover, c.tokensHover]).toEqual(['$0.21 spent during your last message, subagents included', 'input 18k · output 9.0k · cache reads 198k'])
  expect([c.contextPill(true), c.contextPill(false), c.contextHover]).toEqual(['40% full', '40%', '76k of 190k (40%) toward compaction; window 200k; compacts in ~114k'])
  expect(c.limitHover).toEqual({
    '5h': 'Resets in 3h 00m; 5-hour limit, all your Claude use; as of your last reply',
    '7d': 'Resets in 2d 19h; weekly limit, all your Claude use; as of your last reply',
  })
  const off = readingsOf(snapOf({ context: { ...snapOf().context, compactAt: undefined }, fiveHour: { percentUsed: 30, resetsAt: -1, etaMs: null }, sevenDay: undefined })).chips
  expect([off.contextPill(true), off.contextPill(false), off.contextHover]).toEqual(['76k / 200k', '38%', '76k of 200k (38%); older turns get summarized near full'])
  expect(off.limitHover).toEqual({ '5h': '5-hour limit has reset; it updates after your next message', '7d': undefined })
})

test('a cache compacted while idle is its own mood: empty, calm, its estimate the next message\'s', () => {
  const c = readingsOf(snapOf({ cache: { ...cacheAt(0), interrupted: 'compacted' } })).cache
  expect([c.mood, c.charge, c.tone, c.estimateLabel]).toEqual(['compacted', 0, 'calm', 'next message'])
  expect([c.figure, c.figureShort, c.heartAlt]).toEqual(['compacted · next ~$1.66', 'compacted ~$1.66', 'cache compacted'])
  expect(readingsOf(snapOf({ cache: cacheAt(0) })).cache.mood).toBe('cold')
})

test('the cache speaks in words', () => {
  const c = readingsOf(snapOf()).cache
  expect([c.figure, c.figureShort]).toEqual(['52m left', '52m'])
  expect(c.cardHead).toEqual([['52m', 'value'], [' left', 'label']])
  expect(c.alt).toBe('cache 52 minutes left, warm')
  expect([c.hitFrac, c.hitText, c.savedText, c.lastsText]).toEqual([0.96, '96%', '~$11.40', '1h idle'])
  expect(c.coldInMs).toBe(52 * MIN)
})
test('in its last minute the cache is amber, long and short', () => {
  const c = readingsOf(snapOf({ cache: cacheAt(47_000) })).cache
  expect(c.alt).toBe('cache 47 seconds left, cooling, re-warm about $1.66, the cache only')
  expect([c.amber?.long, c.amber?.short]).toEqual(['! 47s left · re-warm ~$1.66', '! 47s'])
})
test("idle on the hour's cache, the card and chips say when Claude Code may compact it", () => {
  const r = readingsOf(snapOf({ cache: { ...cacheAt(50 * MIN), idleCompacts: true } }))
  expect(r.cache.cardNote).toBe('Claude Code may compact it at ~54m idle, before it goes cold.')
  expect(r.chips.cache.hover).toBe('50m left; may be compacted at ~54m idle, before it goes cold')
})
test('working, the cache shows no countdown', () => {
  const c = readingsOf(snapOf({ isWorking: true })).cache
  expect([c.figure, c.figureShort]).toEqual(['warm', 'warm'])
  expect(c.coldInMs).toBeUndefined()
})
test('working, an expiring cache still counts down', () => {
  const c = readingsOf(snapOf({ isWorking: true, cache: cacheAt(47_000) })).cache
  expect(c.coldInMs).toBe(47_000)
  expect(c.alt).toMatch(/, cooling, /)
  expect(c.amber).toBeDefined()
})
test('cold is a price', () => {
  const c = readingsOf(snapOf({ cache: cacheAt(0), zone: fixedZone(0) })).cache
  expect([c.figure, c.figureShort]).toEqual(['cold · re-warm ~$1.66', 'cold ~$1.66'])
  expect(c.alt).toBe('cache cold, re-warm about $1.66, the cache only')
})
test('an hour left is said in full to a reader', () => {
  const c = readingsOf(snapOf({ cache: cacheAt(60 * MIN) })).cache
  expect(c.alt).toBe('cache 1 hour left, warm')
})
test('the countdown never looks like a clock', () => {
  for (const ms of [52 * MIN, 9.5 * MIN, 47_000]) {
    const { figure } = readingsOf(snapOf({ cache: cacheAt(ms) })).cache
    expect(figure).toMatch(/^\d+[hms].* left$/)
    expect(figure).not.toMatch(/\d:\d\d/)
  }
})
test('what a figure shows and how it is classed agree: 79.6% shows 80% and is amber, 79.4% shows 79% and is not', () => {
  const five = (percentUsed: number) => readingsOf(snapOf({ fiveHour: { percentUsed, resetsAt: 3 * HOUR, etaMs: null } })).fiveHour
  expect([five(79.6)?.value, five(79.6)?.tone, five(79.6)?.valueMarked]).toEqual(['80%', 'amber', '80%!'])
  expect([five(79.4)?.value, five(79.4)?.tone, five(79.4)?.valueMarked]).toEqual(['79%', 'calm', '79%'])
  expect([five(94.6)?.valueMarked, five(94.4)?.valueMarked]).toEqual(['95%!!', '94%!'])
  const ctx = (percent: number) => readingsOf(snapOf({ context: { tokens: percent * 2000, window: 200_000, percent, compactAt: undefined, autoCompactOff: true } })).context
  expect([ctx(79.6).pct, ctx(79.6).tone, ctx(79.4).pct, ctx(79.4).tone]).toEqual(['80%', 'amber', '79%', 'calm'])
})
test('clock times appear only when the offset is known', () => {
  const now = Date.UTC(2026, 9, 9, 13, 40)
  const five = { percentUsed: 4, resetsAt: now + 3 * HOUR, etaMs: null }
  expect(readingsOf(snapOf({ now, fiveHour: five })).fiveHour?.resetWhen).toBe('in 3h 00m')
  expect(readingsOf(snapOf({ now, zone: fixedZone(0), fiveHour: five })).fiveHour?.resetWhen).toBe(fmtClock(now + 3 * HOUR, fixedZone(0)))
})
test('limits speak in words, amber with one "! "', () => {
  const r = readingsOf(snapOf({ fiveHour: { percentUsed: 82, resetsAt: 3 * HOUR, etaMs: null } }))
  expect(r.fiveHour?.text).toBe('5h 82%')
  expect([r.fiveHour?.amber?.long, r.fiveHour?.amber?.short]).toEqual(['! 5h 82%', '! 5h 82%'])
  expect([r.fiveHour?.resetWhen, r.fiveHour?.resetInMs]).toEqual(['in 3h 00m', 3 * HOUR])
  expect(r.sevenDay?.pace).toBe('~50% at avg pace')
  expect(r.sevenDay?.alt).toBe("7d limit 30 percent used, fine, about 50 percent at its reset, at the window's average pace")
  expectNear(r.sevenDay?.projectedPct, 30 / (1 - 67 / 168), 1e-3)
})
test('a measured fill is an estimate, with ~', () => {
  const now = Date.UTC(2026, 9, 9, 13, 40)
  const r = readingsOf(snapOf({ now, zone: fixedZone(0), fiveHour: { percentUsed: 84, resetsAt: now + 70 * MIN, etaMs: 40 * MIN } }))
  expect(r.fiveHour?.fullIn).toBe('~40m')
  expect([r.fiveHour?.amber?.long, r.fiveHour?.amber?.short]).toEqual(['! 5h full in ~40m', '! 5h full ~40m'])
  expect(r.fiveHour?.amberValue?.short).toBe('! 5h 84%')
  expect(r.fiveHour?.alt).toBe('5h limit 84 percent used, needs attention, full in about 40 minutes')
})
test('a landing at or over 100% is full before reset, never ~112%', () => {
  const r = readingsOf(snapOf({ sevenDay: { percentUsed: 79, resetsAt: 50 * HOUR } }))
  expect(r.sevenDay?.projectedPct ?? 0).toBeGreaterThan(100)
  expect([r.sevenDay?.tone, r.sevenDay?.pace]).toEqual(['calm', 'full at avg pace'])
  expect(r.sevenDay?.alt).toBe("7d limit 79 percent used, fine, full before its reset, at the window's average pace")
})
test('a measured fill lands at 100, so it too is full before reset', () => {
  const r = readingsOf(snapOf({ fiveHour: { percentUsed: 84, resetsAt: 70 * MIN, etaMs: 40 * MIN } }))
  expect(r.fiveHour?.pace).toBe('full in ~40m')
})
test('a passed window has no reset words', () => {
  const r = readingsOf(snapOf({ now: 4 * HOUR }))
  expect([r.fiveHour?.text, r.fiveHour?.resetWhen]).toEqual(['5h reset', undefined])
})
test('a limit reads its value, or once its window has passed, reset', () => {
  expect(readingsOf(snapOf()).fiveHour?.valueText).toBe('4%')
  expect(readingsOf(snapOf({ now: 4 * HOUR })).fiveHour?.valueText).toBe('reset')
})
test('a passed window has no fill time', () => {
  const r = readingsOf(snapOf({ now: 4 * HOUR, fiveHour: { percentUsed: 84, resetsAt: 3 * HOUR, etaMs: 0 } }))
  expect([r.fiveHour?.fullIn, r.fiveHour?.fillText]).toEqual([undefined, undefined])
  expect(r.fiveHour?.alt).not.toMatch(/full in/)
})
test('context speaks toward compaction, or of the window when it is off', () => {
  const near = readingsOf(snapOf({ context: { tokens: 176_000, window: 200_000, percent: 88, compactAt: 190_000, autoCompactOff: false } })).context
  expect([near.amber?.long, near.amber?.short]).toEqual(['! context 93% · compacts in ~14k', '! ctx 93%'])
  expect([near.alt, near.roomText]).toEqual(['context 93 percent toward compaction, near the limit', '~14k'])
  const off = readingsOf(snapOf({ context: { tokens: 170_000, window: 200_000, percent: 85, compactAt: undefined, autoCompactOff: true } })).context
  expect([off.amber?.long, off.alt]).toEqual(['! context 85%', 'context 85 percent of the window, near the limit'])
})
test('context not reported reads as unknown, never 0%', () => {
  const x = readingsOf(snapOf({ context: { tokens: undefined, window: 200_000, percent: undefined, compactAt: 190_000, autoCompactOff: false } })).context
  expect(x.known).toBe(false)
  expect([x.valueText, x.inContextText, x.roomText]).toEqual(['–', '–', undefined])
  expect(x.alt).toBe('context not reported')
})
test('spend splits its tokens, each with its share', () => {
  const s = readingsOf(snapOf({ history: { costs: [{ usd: 0.21, reWarm: false }], context: [] } })).spend
  expect([s.totalText, s.lastText, s.tokensText]).toEqual(['$3.19', '$0.21', '225k'])
  expect(s.split.map(p => p.label)).toEqual(['input', 'output', 'cache reads'])
  expectNear(s.split[2]?.frac, 198 / 225, 1e-5)
})
test('the history speaks its numbers and its trend', () => {
  const history = { costs: [{ usd: 0.2, reWarm: false }, { usd: 0.2, reWarm: false }, { usd: 0.84, reWarm: true }], context: [] }
  const hist = readingsOf(snapOf({ history })).history()
  expect(hist.numbersShort).toBe('last $0.84')
  expect(hist.warmAvgUsd).toBe(0.2)
  expect(hist.costsAltOf(3)).toBe('cost of the last 3 messages, rising, average $0.20, max $0.84 re-warm, the newest a re-warm')
  expect(hist.costsAltOf(2)).toBe('cost of the last 2 messages, rising, average $0.20, max $0.84 re-warm, the newest a re-warm')
  // A re-warm alone has no warm average.
  expect(hist.costsAltOf(1)).toBe('cost of the last message, rising, max $0.84 re-warm, the newest a re-warm')
  expect(hist.costsAltOf(14)).toBe(hist.costsAltOf(3))
  expect([hist.empty, readingsOf(snapOf()).history().empty]).toEqual([false, true])
})
test('the context trail is spoken with where it compacts, when compaction is on', () => {
  const history = { costs: [], context: [60_000, 50_000, 76_000] }
  expect(readingsOf(snapOf({ history })).history().contextTrailAlt).toBe('context over the conversation, rising, compacts at 190k')
  const off = readingsOf(snapOf({ history: { ...history, context: [90_000, 76_000] }, context: { tokens: 76_000, window: 200_000, percent: 38, compactAt: undefined, autoCompactOff: true } })).history()
  expect(off.contextTrailAlt).toBe('context over the conversation, falling')
  expect(readingsOf(snapOf()).history().contextTrailAlt).toBe('context over the conversation, steady, compacts at 190k')
})
test('the history, week and board are built only when a view calls for them, then kept', () => {
  const r = readingsOf(snapOf())
  for (const key of ['history', 'week', 'board'] as const) {
    // A plain data property, never a getter: reading it runs nothing.
    expect(Object.getOwnPropertyDescriptor(r, key)?.get).toBeUndefined()
    expect(r[key]()).toBe(r[key]())
  }
})
test('the week names its cells in words, for a reader', () => {
  const now = 77 * HOUR
  const T = (hours: number, seven: number, five = 0) => ({ at: hours * HOUR, fivePct: five, sevenPct: seven, fiveResetAt: 80 * HOUR, sevenResetAt: 168 * HOUR })
  const wk = readingsOf(snapOf({
    now, zone: fixedZone(0),
    samples: [T(0, 0), T(15, 6), T(39, 15), T(63, 26), T(75.5, 28, 4), T(76.5, 29, 12), T(77, 30, 12)],
    sevenDay: { percentUsed: 30, resetsAt: 168 * HOUR },
    fiveHour: { percentUsed: 12, resetsAt: 80 * HOUR, etaMs: null },
  })).week()
  expect(wk.daysAlt).toMatch(/^weekly limit by day: \w+day 6%, \w+day 9%/)
  expect(wk.daysAlt).toMatch(/Monday about \d+%/)
  expect(wk.daysAlt).not.toMatch(/[~↻]/)
})
test('with no samples and no pace yet, the week is not known yet', () => {
  // An hour into the window: too early for a landing, so no day is guessed either.
  const wk = readingsOf(snapOf({ now: HOUR, sevenDay: { percentUsed: 1, resetsAt: 168 * HOUR } })).week()
  expect(wk.daysAlt).toBe('weekly limit by day: not known yet')
})

// The week as its board draws it: Sun 15:14, the 7d at 66%, all of it risen
// today, resetting Sat 13:30; the 5h at 0%, resetting in 4h 55m.
const SUN = Date.UTC(2026, 9, 11, 15, 14)
const SAT_RESET = Date.UTC(2026, 9, 17, 13, 30)
const FIVE_RESET = SUN + (4 * 60 + 55) * MIN
const boardSample = (at: number, sevenPct: number) => ({ at, fivePct: 0, sevenPct, fiveResetAt: FIVE_RESET, sevenResetAt: SAT_RESET })
const boardWeek = (percentUsed = 66) => readingsOf(snapOf({
  now: SUN, zone: fixedZone(0),
  samples: [boardSample(SAT_RESET - 168 * HOUR, 0), boardSample(SUN - MIN, percentUsed)],
  sevenDay: { percentUsed, resetsAt: SAT_RESET },
  fiveHour: { percentUsed: 0, resetsAt: FIVE_RESET, etaMs: null },
})).week()
test('week stops its guess at the cap: the fill day takes what is left, and none is left after it', () => {
  const wk = boardWeek()
  expect(wk.dayMarks.map(m => `${m.kind} ${Math.round(m.pct)}`)).toEqual(['measured 66', 'fills 34', 'spent 0', 'spent 0', 'spent 0', 'spent 0', 'spent 0'])
  // calendar.ts still guesses every day ahead alike.
  expect(wk.days.slice(2).every(d => d.guess && (d.pct ?? 0) > 34)).toBe(true)
  expect(boardWeek(100).dayMarks.slice(1).every(m => m.kind === 'spent')).toBe(true)
})
test('the 5h at 0% places no now among its hours', () => {
  const wk = boardWeek()
  // The 5h's first hour measured at 0%, the rest not yet.
  expect(cappedMarks(wk.hours, 0).map(m => m.kind)).toEqual(['measured', 'unknown', 'unknown', 'unknown', 'unknown'])
  expect(wk.fiveHourWindow.nowAt).toBeUndefined()
})
test('the week says its days for a reader', () => {
  expect(boardWeek().daysAlt).toBe('weekly limit by day: Sunday 66%, Monday about 34% and fills it, Tuesday to Saturday none left')
})
test("a limit knows the share of its window gone, and a window with nothing used has no pace", () => {
  expect(readingsOf(snapOf()).fiveHour?.gone).toBeGreaterThan(0)
  const unused = readingsOf(snapOf({ fiveHour: { percentUsed: 0, resetsAt: 3 * HOUR, etaMs: null } }))
  expect(unused.fiveHour?.gone === undefined).toBe(false)
  // Nor a pace: a landing of ~0% says nothing the 0% doesn't.
  expect([unused.fiveHour?.projectedPct, unused.fiveHour?.pace]).toEqual([undefined, ''])
})

// ---- departures' countdowns ---------------------------------------------------

test('a limit fills in its measured time, else on its average once it lands at 100% or more, never once passed', () => {
  const fullIn = (over: Parameters<typeof snapOf>[0]) => readingsOf(snapOf(over)).limits.map(l => l.fullInMs)
  expect(fullIn({})).toEqual([undefined, undefined])
  expect(fullIn({ fiveHour: { percentUsed: 40, resetsAt: 3 * HOUR, etaMs: 40 * MIN } })[0]).toBe(40 * MIN)
  // 79% in the 118h gone of 168: the 21% left takes 118h × 21 / 79.
  const seven = fullIn({ sevenDay: { percentUsed: 79, resetsAt: 50 * HOUR } })[1] ?? 0
  expectNear(seven, (118 * HOUR * 21) / 79, 1)
  expect(fullIn({ now: 4 * HOUR, fiveHour: { percentUsed: 84, resetsAt: 3 * HOUR, etaMs: 0 } })[0]).toBeUndefined()
  // A full window has nothing left to fill, measured or not.
  for (const etaMs of [null, 5 * MIN]) expect(fullIn({ fiveHour: { percentUsed: 100, resetsAt: 2 * HOUR, etaMs } })[0]).toBeUndefined()
})
test('the cache counts down to cold; under 10 minutes it is its last call, a 5-minute cache in its last minute', () => {
  const cache = (over: Partial<ReturnType<typeof snapOf>['cache']>) => readingsOf(snapOf({ cache: { ...snapOf().cache, ...over } })).cache
  expect(cache({}).lastCall).toBe(false)
  const soon = cache({ leftMs: 6 * MIN })
  expect([soon.lastCall, soon.tone]).toEqual([true, 'calm'])
  expect(cache({ leftMs: 10 * MIN }).lastCall).toBe(false)
  expect([cache({ ttl: '5m', leftMs: 4 * MIN }).lastCall, cache({ ttl: '5m', leftMs: 59_000 }).lastCall]).toEqual([false, true])
})
const costs = (list: Array<[number, boolean]>) => readingsOf(snapOf({ history: { costs: list.map(([usd, reWarm]) => ({ usd, reWarm })), context: [] } })).history()
const FIVE = { percentUsed: 4, resetsAt: 3 * HOUR, etaMs: null }

test('the cost fact says the warm average, as an estimate; none before a cost', () => {
  expect(costs([[0.02, false], [0.9, true], [0.02, false]]).costFact?.value).toBe('$0.02 · ~$0.02')
  expect(costs([]).costFact).toBeUndefined()
})
test('beatsTop is never 0 and leaves re-warms out', () => {
  expect(costs([]).beatsTop).toBe(1)
  expect(costs([[0, false], [0, false]]).beatsTop).toBe(1)
  expect(costs([[0.02, false], [0.9, true]]).beatsTop).toBe(0.04)
  expect(costs([[0.9, true]]).beatsTop).toBe(0.9)
})
test('fiveHourWindow climbs slice by slice and marks now', () => {
  const w = readingsOf(snapOf({ samples: SAMPLES, zone: fixedZone(0) })).week().fiveHourWindow
  expect(w.values.length).toBe(5)
  expect(w.nowAt).toBeGreaterThanOrEqual(0)
  for (let i = 1; i < w.values.length; i++) expect(w.values[i]).toBeGreaterThanOrEqual(w.values[i - 1] ?? 0)
})
test('fiveHourWindow is empty with no 5h window, or no slice measured', () => {
  expect(readingsOf(snapOf({ samples: [] })).week().fiveHourWindow.values).toEqual([])
  expect(readingsOf(snapOf({ samples: [], zone: fixedZone(0) })).week().fiveHourWindow.values).toEqual([])
})
test('windowAlt speaks the whole window, not the last hour: its use, its pace as about, no ~; nothing once passed', () => {
  const alt = readingsOf(snapOf({ samples: SAMPLES, zone: fixedZone(0) })).week().windowAlt
  expect(alt).toBe("5h window from start to reset, 4% used, about 10% at the window's average pace")
  expect(alt).not.toMatch(/~/)
  expect(readingsOf(snapOf({ samples: SAMPLES, zone: fixedZone(0), now: 4 * HOUR })).week().windowAlt).toBe('')
})
// A 5h window from 0 to 5h, its samples only from `from` on, as when the
// window opened on another device or the band came mid-window.
const fiveFrom = (samples: ReadonlyArray<readonly [number, number]>, percentUsed: number, now: number) =>
  readingsOf(snapOf({
    zone: fixedZone(0), now,
    fiveHour: { percentUsed, resetsAt: 5 * HOUR, etaMs: null },
    samples: samples.map(([at, fivePct]) => ({ at, fivePct, sevenPct: 30, fiveResetAt: 5 * HOUR, sevenResetAt: 67 * HOUR })),
  }))
test("fiveHourWindow's level now is the window's percentUsed, so the line and its words agree", () => {
  // Samples since 2h: the window was at 20% before the band saw it.
  const r = fiveFrom([[2.2 * HOUR, 20], [3.2 * HOUR, 26]], 26, 3.5 * HOUR)
  const w = r.week().fiveHourWindow
  expect(w.nowAt).toBe(3)
  expect(w.values[w.nowAt ?? -1]).toBe(26)
  // The dashed run lands where the words' pace does.
  const projected = r.fiveHour?.projectedPct
  expect(projected).toBeDefined()
  expectNear(w.values.at(-1), projected ?? NaN, 1e-9)
})
test('fiveHourWindow leaves the hours before its first sample undrawn: their level is not known', () => {
  // The first sample in hour 3, at 26%; then 30% in hour 4. Hours 0 to 2
  // are not known, and hour 3 is drawn from its end, where 26% stood.
  const w = fiveFrom([[3.2 * HOUR, 26], [4.2 * HOUR, 30]], 30, 4.5 * HOUR).week().fiveHourWindow
  expect(w.nowAt).toBe(4)
  expect(w.from).toBe(3)
  expect(w.values[4]).toBe(30)
  expect(w.values[3]).toBe(26)
})
test('fiveHourWindow, measured from the window start, is drawn whole, and a later reading lifts now, not the past', () => {
  // From the window start: hour 0 rises 5, hour 1 to 12; now in hour 2, the reading says 14.
  const w = fiveFrom([[0.5 * HOUR, 5], [1.5 * HOUR, 12]], 14, 2.5 * HOUR).week().fiveHourWindow
  expect(w.from).toBe(0)
  expect(w.values.slice(0, 3)).toEqual([5, 12, 14])
})
test("a recalled cache's time is marked ~ in pulse's words, until a reply measures it", () => {
  const cache = (over: Partial<ReturnType<typeof snapOf>['cache']>) => readingsOf(snapOf({ cache: { ...snapOf().cache, ...over } })).cache
  expect([cache({ requests: 0, recalled: true }).figure, cache({ requests: 0, recalled: true }).figureShort]).toEqual(['~52m left', '~52m'])
  expect([cache({}).figure, cache({}).figureShort]).toEqual(['52m left', '52m'])
  expect(cache({ requests: 1, recalled: true }).figure).toBe('52m left')
})
test("at the 5h window's very end, now is its last slice", () => {
  // A minute before the reset, as the samples' window ends.
  const w = readingsOf(snapOf({ samples: SAMPLES, zone: fixedZone(0), fiveHour: FIVE, now: 3 * HOUR - MIN })).week().fiveHourWindow
  expect(w.values.length).toBeGreaterThan(1)
  expect(w.nowAt).toBe(w.values.length - 1)
})
test("pulse's tiles are named, and another window's line says its name among its words", () => {
  const calm = readingsOf(snapOf({ zone: fixedZone(0) }))
  expect([calm.cache.bandName, calm.spend.bandName, calm.context.bandName, calm.fiveHour?.bandName, calm.sevenDay?.bandName]).toEqual(['cache', 'spend', 'context', '5h', '7d'])
  const other = (percentUsed: number) => readingsOf(snapOf({ otherLimits: [{ kind: 'spend_limit', percentUsed, resetsAt: undefined }] })).limits.find(l => l.key === 'other')?.line
  expect([other(40), other(85)]).toEqual(['spend 40%', '! spend 85%'])
})
test("the 7d's days as drawn: capped, so the guesses never pass what is left; today kept", () => {
  const week = readingsOf(snapOf({ samples: SAMPLES, zone: fixedZone(0), sevenDay: { percentUsed: 85, resetsAt: 67 * HOUR } })).week()
  const d = week.daysDrawn
  expect(d.values.reduce<number>((n, v, i) => n + (d.guess[i] ? (v ?? 0) : 0), 0)).toBeLessThanOrEqual(15 + 1e-9)
  expect(d.today).toBe(week.days.findIndex(day => day.today))
  expect(d.measured).toBe(true)
})
test("today's fill with no reading inside today yet is a guess of what is left, as its alt says, never a measured 0", () => {
  // The sign-off's unknown zone: now is midnight UTC, so every sample falls
  // before today, and no day before it has a reading at its start.
  const at = (m: number, sevenPct: number) => ({ at: m * MIN, fivePct: 0, sevenPct, fiveResetAt: 3 * HOUR, sevenResetAt: 67 * HOUR })
  const weekOf = (samples: ReturnType<typeof at>[]) =>
    readingsOf(snapOf({ zone: undefined, sevenDay: { percentUsed: 85, resetsAt: 67 * HOUR }, samples })).week()
  const late = [at(-120, 70), at(-90, 74), at(-60, 78), at(-30, 82), at(-5, 85)]
  for (const week of [weekOf(late), weekOf([at(-30 * 60, 60), ...late])]) {
    const today = week.daysDrawn.today ?? -1
    expect(week.dayMarks[today]).toEqual({ kind: 'fills', pct: 15 })
    expect(week.daysAlt).toMatch(/Thursday about 15% and fills it/)
    expect([week.daysDrawn.values[today], week.daysDrawn.guess[today]]).toEqual([15, true])
  }
  // No day measured: the cells aren't drawn, the 7d is words (the three-layouts spec §4.1).
  expect(weekOf(late).daysDrawn.measured).toBe(false)
  // Wednesday measured from a reading before its start: the cells are drawn.
  expect(weekOf([at(-30 * 60, 60), ...late]).daysDrawn.measured).toBe(true)
})
test("`no costs yet` is said only while there is no cost at all: no message's and a total of $0", () => {
  const none = { history: NO_HISTORY }
  expect(readingsOf(snapOf({ ...none, costUsd: 0 })).history().costsNote).toBe('no costs yet')
  expect(readingsOf(snapOf({ ...none, costUsd: 2.41 })).history().costsNote).toBeUndefined()
  expect(readingsOf(snapOf({ costUsd: 0, history: { costs: [{ usd: 0.2, reWarm: false }], context: [] } })).history().costsNote).toBeUndefined()
})

test('a context window of 0 reads 0%, never NaN%', () => {
  const r = readingsOf(snapOf({ context: { tokens: 0, window: 0, percent: undefined, compactAt: undefined, autoCompactOff: false } }))
  expect(r.context.pct).toBe('0%')
  expect(r.context.alt).not.toMatch(/NaN|Infinity/)
})

test("the last message's cost is one fact: the spend's words and the history's read the trail's newest", () => {
  const r = readingsOf(snapOf({ history: { costs: [{ usd: 0.5, reWarm: false }, { usd: 0.08, reWarm: false }], context: [] } }))
  expect([r.spend.lastText, r.history().lastText]).toEqual(['$0.08', '$0.08'])
  expect(readingsOf(snapOf({ history: NO_HISTORY })).spend.lastText).toBeUndefined()
})
