// The phrasebook the layouts speak: clock times, countdowns in words,
// spoken durations, amber, pace, resets, empty states and alt text.

import { test, expect } from 'claude-code/testing'
import { fixedZone, fmtClock, fmtDay, fmtDayClock, fmtEtaSpoken, fmtLeft, fmtLeftSpoken } from '../hooks/format'
import { AMBER, EMPTY, altOf, paceText } from '../hooks/words'
import { MIN } from './helpers'

const T = Date.UTC(2026, 9, 9, 13, 40) // a Friday, 13:40 UTC
const UTC = fixedZone(0)

test('clock times are local and 24-hour', () => {
  expect(fmtClock(T, UTC)).toBe('13:40')
  expect(fmtClock(T, fixedZone(120))).toBe('15:40')
  expect(fmtClock(T, fixedZone(-330))).toBe('08:10')
})
test('a clock time on another day names the day', () => {
  expect(fmtDayClock(T + 3 * 60 * MIN, UTC, T)).toBe('16:40')
  expect(fmtDayClock(T + 67 * 60 * MIN, UTC, T)).toBe('Mon 08:40')
})
test("a projection's day is today's clock, else its weekday, a week on the next one", () => {
  expect([fmtDay(T + 3 * 60 * MIN, UTC, T), fmtDay(T + 67 * 60 * MIN, UTC, T), fmtDay(T + 6 * 24 * 60 * MIN, UTC, T)]).toEqual(['16:40', 'Mon', 'Thu'])
  // Friday a week on is not today.
  expect(fmtDay(T + (7 * 24 - 1) * 60 * MIN, UTC, T)).toBe('next Fri')
})
test('a countdown is words, never a clock', () => {
  expect(fmtLeft(60 * MIN)).toBe('1h 00m left')
  expect(fmtLeft(52 * MIN)).toBe('52m left')
  expect(fmtLeft(9.5 * MIN)).toBe('10m left')
  expect(fmtLeft(47_000)).toBe('47s left')
  expect(fmtLeft(400)).toBe('1s left')
  for (const ms of [60 * MIN, 52 * MIN, 9.5 * MIN, 47_000]) expect(fmtLeft(ms)).not.toMatch(/\d:\d\d/)
})
test('a screen reader hears durations spelled out', () => {
  expect(fmtLeftSpoken(60 * MIN)).toBe('1 hour left')
  expect(fmtLeftSpoken(65 * MIN)).toBe('1 hour 5 minutes left')
  expect(fmtLeftSpoken(52 * MIN)).toBe('52 minutes left')
  expect(fmtLeftSpoken(47_000)).toBe('47 seconds left')
  expect(fmtLeftSpoken(1_000)).toBe('1 second left')
  expect(fmtEtaSpoken(40 * MIN)).toBe('about 40 minutes')
  expect(fmtEtaSpoken(60 * MIN)).toBe('about 1 hour')
  expect(fmtEtaSpoken(75 * MIN)).toBe('about 1 hour 15 minutes')
})
test('the spoken countdown counts the minutes the drawn one shows', () => {
  // Each sits just under a minute, where the rounding decides the minute.
  expect([fmtLeft(11 * MIN - 400), fmtLeftSpoken(11 * MIN - 400)]).toEqual(['11m left', '11 minutes left'])
  expect([fmtLeft(60 * MIN - 400), fmtLeftSpoken(60 * MIN - 400)]).toEqual(['1h 00m left', '1 hour left'])
  expect([fmtLeft(65 * MIN), fmtLeftSpoken(65 * MIN)]).toEqual(['1h 05m left', '1 hour 5 minutes left'])
})
test('pace speaks a measured rate first, then the average', () => {
  expect(paceText({ etaMs: 40 * MIN, projectedPct: 50 })).toBe('full in ~40m')
  expect(paceText({ etaMs: null, projectedPct: 112 })).toBe('full before reset')
  expect(paceText({ etaMs: null, projectedPct: 9.6 })).toBe('on pace for ~10%')
  expect(paceText({ etaMs: null, projectedPct: undefined })).toBe('')
})
test('every amber phrase, long and short, starts with "! " once', () => {
  const all = [
    AMBER.cache('47s', '~$1.66'),
    AMBER.context(0.93, 12_000),
    AMBER.contextNoCompaction(0.85),
    AMBER.limit('5h', 82),
    AMBER.limitPace('5h', '~40m'),
  ]
  expect(all.map(({ long, short }) => ({ long, short }))).toEqual([
    { long: '! 47s left · re-warm ~$1.66', short: '! 47s' },
    { long: '! context 93% · compacts in ~12k', short: '! ctx 93%' },
    { long: '! context 85%', short: '! ctx 85%' },
    { long: '! 5h 82%', short: '! 5h 82%' },
    { long: '! 5h full in ~40m', short: '! 5h full ~40m' },
  ])
  for (const a of all) for (const s of [a.long, a.short]) {
    expect(s.startsWith('! ')).toBe(true)
    expect(s.match(/!/g)?.length).toBe(1)
  }
})
test('empty states read like the band', () => {
  expect(EMPTY).toEqual({
    costs: "Costs show after Claude's next reply.",
    costsShort: 'no costs yet',
    costsAlt: 'cost per message: none yet',
    context: 'not reported',
  })
})
test('alt text is words: no ~ and no ↻', () => {
  const alts = [
    altOf('5h limit', '84 percent used', 'needs attention', 'full in about 40 minutes'),
    altOf('cache', '52 minutes left', 'warm'),
    altOf('cache', 'cold', 're-warm about $1.66'),
  ]
  expect(alts).toEqual(['5h limit 84 percent used, needs attention, full in about 40 minutes', 'cache 52 minutes left, warm', 'cache cold, re-warm about $1.66'])
  for (const a of alts) expect(a).not.toMatch(/[~↻]/)
})
