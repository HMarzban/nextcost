// Numbers, times and escalation marks, as the band words them, and the
// paint key: every phrase the clock alone moves, as one key.

export const MINUTE_MS = 60_000
/** The cache's last minute: the one span where acting changes the bill. */
export const SOON_MS = MINUTE_MS
/** Under ten minutes a countdown is close: see `grainOf`. */
const CLOSE_MS = 10 * MINUTE_MS

/** How finely a countdown with `ms` left is said: `seconds` in its last
 *  minute, where every form counts seconds; `close` under ten minutes, where
 *  chips' `M:SS` still does and the other forms count whole minutes rounded
 *  up; else `minutes`, whole and rounded down. */
export const grainOf = (ms: number): 'seconds' | 'close' | 'minutes' => (ms < MINUTE_MS ? 'seconds' : ms < CLOSE_MS ? 'close' : 'minutes')

/** Departures' calm last call: an hour's cache this near cold says LAST CALL at
 *  its clock, in the board's calm ink, from where its countdown is close.
 *  Only the last minute is amber. */
export const LAST_CALL_MS = CLOSE_MS

/** At this share a pill turns amber and gains `!`, and a toast speaks. */
export const WARN_AT = 0.8
/** At this share the mark becomes `!!`, and a toast speaks again. */
export const SEVERE_AT = 0.95
/** Within this share of the compaction point, context counts down to it. */
const COMPACT_NEAR = 0.9

/** `part` as a share of `whole`; a share of nothing is none. */
const shareOf = (part: number, whole: number): number => (whole > 0 ? part / whole : 0)

/** How full the context is against where it runs out, and the levels it
 *  escalates at there: toward compaction, where it is on and its point
 *  known, near it; else toward the window, at the warning and severe lines.
 *  Unclamped: a reading clamps it, a toast escalates on it as it is. */
export const contextPressure = (used: number, window: number, compactAt: number | undefined): Readonly<{ frac: number; levels: readonly number[] }> =>
  compactAt === undefined ? { frac: shareOf(used, window), levels: [WARN_AT, SEVERE_AT] } : { frac: shareOf(used, compactAt), levels: [COMPACT_NEAR] }

/** The tokens left before auto-compaction runs at `compactAt`; none once past it. */
export const toCompaction = (used: number, compactAt: number): number => Math.max(0, compactAt - used)

/** `n` held to 0–1; NaN, a share of nothing, is 0. */
export const clamp01 = (n: number): number => (Number.isNaN(n) || n < 0 ? 0 : n > 1 ? 1 : n)

/** A percent as a whole one: 82.4 is `82%`. */
export const fmtPercent = (percent: number): string => `${Math.round(percent)}%`
/** A share as a whole percent: 0.38 is `38%`. */
export const fmtPct = (frac: number): string => fmtPercent(frac * 100)

/** A share as the whole percent it shows, 0.796 as 0.8: what a pill or a toast
 *  is classed by, so 79.6% shown as `80%` is not calm beside the warning line
 *  at 80%. Rounds as `fmtPct` does. */
export const shownFrac = (frac: number): number => Math.round(frac * 100) / 100

export const fmtTokens = (n: number): string => {
  const v = Math.max(0, Math.round(n))
  // Each unit from where the one below would round up to it: 9,999 is 10k,
  // not 10.0k; 999,999 is 1.0M, not 1000k; 999.95M is 1.0B, not 1000.0M.
  if (v >= 999_950_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 999_500) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 9_950) return `${Math.round(v / 1000)}k`
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

/** Whole dollars from $1,000, and from what would round to it. */
const WHOLE_FROM = 999.995

/** Whole dollars grouped by thousands, `1,027`: by hand, since the sandbox's
 *  locale formatting can't be relied on. */
const wholeDollars = (usd: number): string => String(Math.round(usd)).replace(/\B(?=(\d{3})+$)/g, ',')

export const fmtCost = (usd: number): string => (usd >= WHOLE_FROM ? `$${wholeDollars(usd)}` : `$${usd.toFixed(2)}`)

/** A small figure honestly: under a cent is not $0.00. */
export const fmtSmallCost = (usd: number): string => (usd < 0.01 ? '<$0.01' : fmtCost(usd))

/** An estimate is always marked as one. */
export const fmtEstimate = (usd: number): string => `~${fmtSmallCost(usd)}`

/** The countdowns' seconds, drawn and spoken alike. */
const wholeSeconds = (ms: number): number => Math.max(0, Math.round(ms / 1000))

/** From an hour, `1h 05m`; from ten minutes, whole minutes; below, `M:SS`.
 *  The countdown is still for most of its life and ticks only when ticking
 *  means something. */
export const fmtCountdown = (ms: number): string => {
  const secs = wholeSeconds(ms)
  if (secs >= 3600) {
    const hours = Math.floor(secs / 3600)
    return `${hours}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`
  }
  if (grainOf(secs * 1000) === 'minutes') return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

/** How far off a reset is: the time left, or that it has already passed. */
export type ResetIn = { kind: 'in'; text: string } | { kind: 'passed' }

/** A span coarsely, to the minute: `2d 4h`, `3h 05m`, `12m`, `<1m`. */
const fmtSpan = (ms: number): string => {
  const mins = Math.floor(Math.max(0, ms) / MINUTE_MS)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days) return `${days}d ${hours % 24}h`
  if (hours) return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
  return mins > 0 ? `${mins}m` : '<1m'
}

/** The time to a reset `ms` off: coarsely, and while close in whole minutes
 *  rounded up, as every close countdown counts. */
const fmtResetSpan = (ms: number): string => (grainOf(ms) === 'close' ? `${minutesLeft(ms)}m` : fmtSpan(ms))

/** When a reset the engine names in ISO time comes, epoch ms; undefined
 *  without a readable time. */
export const parseReset = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined
  const at = Date.parse(iso)
  return Number.isNaN(at) ? undefined : at
}

/** When a reset at `at` comes, from `now`; undefined without one. */
export const resetIn = (at: number | undefined, now: number): ResetIn | undefined => {
  if (at === undefined) return undefined
  const left = at - now
  return left <= 0 ? { kind: 'passed' } : { kind: 'in', text: fmtResetSpan(left) }
}

/** The words for escalation: colour is never the only signal. By the percent
 *  shown, as the amber is. */
export const severityMark = (frac: number): string => {
  const shown = shownFrac(frac)
  return shown >= SEVERE_AT ? '!!' : shown >= WARN_AT ? '!' : ''
}

/** Where a projection's step goes from 5 minutes to 15: 57.5 minutes rounds to the hour. */
const ETA_QUARTER_FROM_MIN = 57.5

/** A projection's whole minutes: 5-minute steps under an hour, 15 from one. */
export const etaMinutes = (ms: number): number => {
  const mins = Math.max(0, ms) / MINUTE_MS
  return mins < ETA_QUARTER_FROM_MIN ? Math.max(5, Math.round(mins / 5) * 5) : Math.round(mins / 15) * 15
}

/** A projection, never a countdown: `~40m`, `~1h`, `~1h 15m`. */
export const fmtEta = (ms: number): string => {
  const mins = etaMinutes(ms)
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return hours === 0 ? `~${mins}m` : rest ? `~${hours}h ${rest}m` : `~${hours}h`
}

/** How long ago, coarsely: `2d 4h`, `3h 05m`, `12m`; under a minute is `now`. */
export const fmtAgo = (ms: number): string => (ms < MINUTE_MS ? 'now' : fmtSpan(ms))

export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
/** The 5-hour limit's window. */
export const FIVE_HOUR_MS = 5 * HOUR_MS
/** The weekly limit's window. */
export const SEVEN_DAY_MS = 7 * DAY_MS
/** Resets read of one window can differ by a few seconds. */
const SAME_RESET_MS = MINUTE_MS
/** Whether two resets name one window: both unknown, or within a minute. */
export const sameReset = (a: number | undefined, b: number | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < SAME_RESET_MS)

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** A zone: its offset from UTC at an instant, east-positive minutes. Read
 *  per instant, so a reset past a daylight-saving change says its own clock. */
export type Zone = (ms: number) => number
/** A zone from a clock's minutes behind UTC at each instant, as
 *  getTimezoneOffset reports them (`0 -` keeps a UTC offset +0). */
export const zoneOf =
  (behind: (ms: number) => number): Zone =>
  ms =>
    0 - behind(ms)
/** This machine's zone, as its clock reports each instant. */
export const hostZone: Zone = zoneOf(ms => new Date(ms).getTimezoneOffset())
/** `zone`, or undefined where its offset at `now` can't be read, so the band
 *  counts down instead. */
export const readableZone = (zone: Zone, now: number): Zone | undefined => (Number.isFinite(zone(now)) ? zone : undefined)
/** A zone whose offset never changes. */
export const fixedZone =
  (min: number): Zone =>
  () =>
    min

/** `ms` as local wall time, to be read through the UTC getters. */
const wallTime = (ms: number, zone: Zone): number => ms + zone(ms) * MINUTE_MS
const hhmm = (wall: number): string => {
  const at = new Date(wall)
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

/** When a projection `etaMs` away fills, at `ms`, rounded as its ETA is: the
 *  minutes of the clock it will be read on go to 5 under an hour and 15 from
 *  one, so `~1h 15m` doesn't come with a clock to the minute. */
export const fillTime = (ms: number, etaMs: number, zone: Zone): number => {
  const step = (etaMs / MINUTE_MS < ETA_QUARTER_FROM_MIN ? 5 : 15) * MINUTE_MS
  return Math.round(wallTime(ms, zone) / step) * step - zone(ms) * MINUTE_MS
}

/** A local 24-hour clock time: `14:32`. */
export const fmtClock = (ms: number, zone: Zone): string => hhmm(wallTime(ms, zone))

/** The local day `ms` falls on, counted from the epoch. */
export const dayOf = (ms: number, zone: Zone): number => Math.floor(wallTime(ms, zone) / DAY_MS)

/** The first instant of local day `day`: the earliest of three passes that
 *  lands on the day, at the offset in force there and an hour before. Where
 *  midnight falls in a spring-forward gap, one lands in the day before, and
 *  the day starts at the gap's end; where it comes twice, at a fall back to
 *  00:00, the hour before finds the first. */
export const midnightOf = (day: number, zone: Zone): number => {
  const at = (offsetAt: number): number => day * DAY_MS - zone(offsetAt) * MINUTE_MS
  const first = at(day * DAY_MS)
  const landed = [first, at(first), at(first - HOUR_MS)].filter(t => dayOf(t, zone) === day)
  return landed.length === 0 ? first : Math.min(...landed)
}

/** Whether `ms` falls on the same local day as `now`, each under its own offset. */
const isToday = (ms: number, zone: Zone, now: number): boolean => dayOf(ms, zone) === dayOf(now, zone)

/** The weekday `ms` falls on, `Sat`; a week or more on `next Sat`, so it
 *  never reads as today's. */
const weekdayOf = (ms: number, zone: Zone, now: number): string => {
  const day = WEEKDAYS[new Date(wallTime(ms, zone)).getUTCDay()]?.slice(0, 3) ?? ''
  return dayOf(ms, zone) - dayOf(now, zone) >= 7 ? `next ${day}` : day
}

/** A clock time, with its weekday when it isn't today: `16:40`, `Mon 08:40`, `next Sat 13:30`. */
export const fmtDayClock = (ms: number, zone: Zone, now: number): string =>
  isToday(ms, zone, now) ? fmtClock(ms, zone) : `${weekdayOf(ms, zone, now)} ${fmtClock(ms, zone)}`

/** A projection's day, which its minute would claim too much for: its
 *  weekday, `Mon`, a week on `next Sun`, or today its clock time, `16:40`. */
export const fmtDay = (ms: number, zone: Zone, now: number): string => (isToday(ms, zone, now) ? fmtClock(ms, zone) : weekdayOf(ms, zone, now))

/** Whole seconds left, never 0 while any remain. */
const secondsLeft = (ms: number): number => Math.max(1, Math.ceil(ms / 1000))
/** Whole minutes left: rounded up while close, then as `fmtCountdown`
 *  counts them. */
const minutesLeft = (ms: number): number => (grainOf(ms) === 'minutes' ? Math.floor(wholeSeconds(ms) / 60) : Math.ceil(ms / MINUTE_MS))

/** The countdown alone, for a tile or a pill: `1h 00m`, `52m`, `10m`, `47s`. */
export const fmtLeftShort = (ms: number): string => {
  const grain = grainOf(ms)
  return grain === 'seconds' ? `${secondsLeft(ms)}s` : grain === 'close' ? `${minutesLeft(ms)}m` : fmtCountdown(ms)
}

/** A countdown in words: `1h 00m left`, `52m left`, `10m left`, `47s left`. */
export const fmtLeft = (ms: number): string => `${fmtLeftShort(ms)} left`

/** A measured span on the departures board: `47S`, `38 MIN`, `1H 04M`.
 *  Never `38M`. */
export const boardSpan = (ms: number): string =>
  grainOf(ms) === 'seconds' ? `${secondsLeft(ms)}S` : ms < HOUR_MS ? `${minutesLeft(ms)} MIN` : fmtCountdown(ms)

export const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`

/** Whole minutes spelled out: `40 minutes`, `1 hour`, `1 hour 5 minutes`. */
const spokenMinutes = (mins: number): string => {
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return [hours > 0 ? plural(hours, 'hour') : '', rest > 0 || hours === 0 ? plural(rest, 'minute') : ''].filter(Boolean).join(' ')
}

/** The same countdown as a screen reader should hear it: `1 hour 5 minutes left`. */
export const fmtLeftSpoken = (ms: number): string =>
  `${grainOf(ms) === 'seconds' ? plural(secondsLeft(ms), 'second') : spokenMinutes(minutesLeft(ms))} left`

/** A projection spelled out, rounded as `fmtEta` rounds it: `about 40 minutes`. */
export const fmtEtaSpoken = (ms: number): string => `about ${spokenMinutes(etaMinutes(ms))}`

/** The context in use: its token count, else its percent of the window;
 *  undefined when the engine reports neither. */
export const contextUsed = (ctx: Readonly<{ tokens?: number; percent?: number; window: number }>): number | undefined =>
  ctx.tokens ?? (ctx.percent === undefined ? undefined : (ctx.percent / 100) * ctx.window)

/** A reset's countdown as every layout says it: the span a card and, with
 *  no zone known, a limit's words say, and the board's, which with no zone
 *  counts its last minute's seconds; with a zone the board says a clock. */
const resetSpans = (left: number, zone: Zone | undefined): string =>
  left <= 0 ? 'passed' : zone === undefined ? `${fmtResetSpan(left)} ${boardSpan(left)}` : fmtResetSpan(left)

/** Every phrase the clock alone moves, as one key, so the 1-second tick
 *  repaints only when one would read differently: the minute (the clocks,
 *  the battery and the average's pace), the cache's countdown, how long a
 *  recalled cache has sat idle (null when none is drawn), which turns on its
 *  last reply's minute, the 5-hour fill's projection, and each reset's
 *  countdown, which turns on the reset's own minute. The minute turns just
 *  past the boundary, as the countdowns to a time on the minute do: on it,
 *  they still read the minute before. */
export const paintKey = (
  now: number,
  t: Readonly<{ cacheLeft: number; idleMs: number | null; etaMs: number | null; resets: readonly number[]; zone: Zone | undefined }>,
): string =>
  [
    Math.ceil(now / MINUTE_MS),
    fmtCountdown(t.cacheLeft),
    t.cacheLeft > 0,
    t.idleMs === null ? '-' : fmtAgo(t.idleMs),
    t.etaMs === null ? '-' : fmtEta(t.etaMs),
    ...t.resets.map(at => resetSpans(at - now, t.zone)),
  ].join('|')
