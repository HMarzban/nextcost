import { test, expect } from 'claude-code/testing'
import { cappedMarks, drawnWeekOf, weekOf, windowNowAt } from '../hooks/calendar'
import type { HourCell } from '../hooks/calendar'
import { fixedZone } from '../hooks/format'
import { HOUR as H, expectNear } from './helpers'

/** A cell as a reader would say it: '6%', '~7%' (a guess), '' (unknown). */
const said = (c: Readonly<{ pct: number | undefined; guess: boolean }>): string => (c.pct === undefined ? '' : `${c.guess ? '~' : ''}${Math.round(c.pct)}%`)
const initial = (d: Readonly<{ name: string }>): string => d.name.slice(0, 1)
/** The week's days by initial, today in brackets, as day cells mark it in text: 'W[T]FSSMT'. */
const marked = (days: ReadonlyArray<Readonly<{ name: string; today: boolean }>>): string => days.map(d => (d.today ? `[${initial(d)}]` : initial(d))).join('')

const T0 = Date.UTC(2026, 9, 6, 8, 40) // Tue 08:40 UTC, the 7d window's start
const s = (hours: number, seven: number, five = 0) => ({ at: T0 + hours * H, fivePct: five, sevenPct: seven, fiveResetAt: T0 + (Math.floor(hours / 5) + 1) * 5 * H, sevenResetAt: T0 + 168 * H })
const seven = (percentUsed: number, projectedPct: number) => ({ percentUsed, projectedPct, resetsAt: T0 + 168 * H })

test("a day cell is that day's rise in the weekly limit", () => {
  const wk = weekOf({ samples: [s(0, 0), s(15, 6), s(39, 15), s(63, 26), s(77, 30)], seven: seven(30, 50), five: undefined, now: T0 + 77 * H, zone: fixedZone(0) })
  expect(marked(wk.days)).toBe('TWT[F]SSM')
  expect(wk.days.slice(0, 4).map(said)).toEqual(['6%', '9%', '11%', '4%'])
  expect(wk.days.map(d => d.guess)).toEqual([false, false, false, false, true, true, true])
  expectNear(wk.days[4]?.pct, (50 - 30) / 3, 1e-5)
  expect(wk.days[4] && said(wk.days[4])).toBe('~7%')
})
test('a sample from another window is ignored', () => {
  const stale = { ...s(15, 50), sevenResetAt: T0 - H }
  const wk = weekOf({ samples: [s(0, 0), s(10, 5), stale], seven: seven(5, 20), five: undefined, now: T0 + 20 * H, zone: fixedZone(0) })
  expect(Math.max(...wk.days.map(d => (d.guess ? 0 : (d.pct ?? 0))))).toBeLessThan(50)
})
test('no samples: every past cell is unknown, never 0%', () => {
  const wk = weekOf({ samples: [], seven: seven(30, 50), five: undefined, now: T0 + 77 * H, zone: fixedZone(0) })
  expect(wk.days.slice(1, 4).every(d => d.pct === undefined && said(d) === '')).toBe(true)
})
test('the hour cells are the five hours before the 5h reset, with now and the fill marked', () => {
  const five = { percentUsed: 40, projectedPct: 100, resetsAt: T0 + 5 * H, fullAt: T0 + 4.2 * H, gone: 0.5 }
  const wk = drawnWeekOf({ samples: [s(0, 0, 0), s(0.9, 1, 10), s(1.9, 2, 25), s(2.4, 3, 40)], seven: undefined, five, now: T0 + 2.5 * H, zone: fixedZone(0) })
  expect(wk.hours.map(said)).toEqual(['10%', '15%', '15%', '~30%', '~30%'])
  expect(wk.fiveHourWindow.nowAt).toBe(2)
  expect(wk.hours.findIndex(c => c.fullMark)).toBe(4)
})
test('a fill at the reset itself fills on the last day', () => {
  const wk = weekOf({ samples: [], seven: { ...seven(30, 100), fullAt: T0 + 168 * H }, five: undefined, now: T0 + 77 * H, zone: fixedZone(0) })
  expect(wk.days.findIndex(d => d.fullMark)).toBe(6)
})
test('a measured fill marks its hour over the guess', () => {
  const five = { percentUsed: 40, projectedPct: 100, resetsAt: T0 + 5 * H, fullAt: T0 + 3.5 * H }
  const wk = weekOf({ samples: [], seven: undefined, five, now: T0 + 2.5 * H, zone: fixedZone(0) })
  expect(wk.hours.findIndex(c => c.fullMark)).toBe(3)
})
test('the days are cut at local midnight, so today is the day it is', () => {
  // The reset at 20:00: before 20:00 a cut at the reset's clock time named
  // yesterday as today. The 4-hour start of the window folds into Wednesday.
  const R = Date.UTC(2026, 9, 13, 20)
  const at = (day: number, hour: number) => Date.UTC(2026, 9, day, hour)
  const sample = (ms: number, sevenPct: number) => ({ at: ms, fivePct: 0, sevenPct, fiveResetAt: ms + H, sevenResetAt: R })
  const samples = [sample(at(6, 23), 2), sample(at(7, 22), 5), sample(at(8, 1), 7), sample(at(8, 14), 12)]
  const weekAt = (now: number, offset = 0) => weekOf({ samples: samples.filter(x => x.at <= now), seven: { percentUsed: 12, projectedPct: 30, resetsAt: R }, five: undefined, now, zone: fixedZone(offset) })
  const week = (now: number, offset = 0) => marked(weekAt(now, offset).days)
  // Wednesday 7th to Tuesday 13th, today Thursday 8th.
  expect(week(at(8, 15))).toBe('W[T]FSSMT')
  // Each day's own rise: Wednesday's 22:00 sample counts on Wednesday.
  expect(weekAt(at(8, 15)).days.slice(0, 2).map(said)).toEqual(['5%', '7%'])
  expect(week(at(7, 21))).toBe('[W]TFSSMT')
  expect(week(at(13, 10))).toBe('WTFSSM[T]')
  // Today in the window's first hours, Tuesday 6th: the other partial day folds instead.
  expect(week(at(6, 21))).toBe('[T]WTFSSM')
  // The same instants an hour and a half east, at 03:30 local.
  expect(week(at(8, 2), 90)).toBe('W[T]FSSMT')
})
test('a sample exactly at local midnight closes the day before and opens the day it starts', () => {
  // An hour and a half east, Tuesday's window part ends at Wednesday 00:00 local, 22:30 UTC.
  const midnight = Date.UTC(2026, 9, 6, 22, 30)
  const sample = (at: number, sevenPct: number) => ({ at, fivePct: 0, sevenPct, fiveResetAt: at + H, sevenResetAt: T0 + 168 * H })
  const samples = [sample(T0, 0), sample(midnight, 6), sample(midnight + 12 * H, 9)]
  const wk = weekOf({ samples, seven: seven(9, 20), five: undefined, now: midnight + 14 * H, zone: fixedZone(90) })
  expect(wk.days.slice(0, 2).map(d => `${d.name} ${said(d)}`)).toEqual(['Tuesday 6%', 'Wednesday 3%'])
})
test("on the reset's own day, before it resets, today is that day", () => {
  const R = T0 + 168 * H // Tue 08:40
  const wk = weekOf({ samples: [], seven: seven(80, 90), five: undefined, now: R - 6 * H, zone: fixedZone(0) })
  expect(marked(wk.days)).toBe('WTFSSM[T]')
})
test("capped, the slice marked full takes what is left, even where the step's guess says otherwise", () => {
  const cell = (pct: number, guess: boolean, fullMark = false): HourCell => ({ pct, guess, fullMark })
  const marks = (cells: HourCell[], used: number) => cappedMarks(cells, used).map(m => `${m.kind} ${m.pct}`)
  // A measured fill lands sooner than the step: its slice still fills the cap.
  expect(marks([cell(50, false), cell(10, true, true), cell(10, true)], 50)).toEqual(['measured 50', 'fills 50', 'spent 0'])
  // Or later: the guesses before it spend what is left, and it is still the fill.
  expect(marks([cell(70, false), cell(40, true), cell(40, true, true), cell(40, true)], 70)).toEqual(['measured 70', 'guess 30', 'fills 0', 'spent 0'])
})
test("the 5h's now stays on the chart: at the window's very end it is the last slice, and with no slice none", () => {
  expect(windowNowAt(5, 5)).toBe(4)
  expect(windowNowAt(4.99, 5)).toBe(4)
  expect(windowNowAt(2.5, 5)).toBe(2)
  expect(windowNowAt(3, 0)).toBeUndefined()
  expect(windowNowAt(undefined, 5)).toBeUndefined()
})
test('as drawn, the days ahead are guessed only up to what is left, and the cells say which are guesses', () => {
  // 30% used by Friday, on pace for 130%: the raw guesses ahead would pass the 70 points left.
  const wk = drawnWeekOf({ samples: [s(0, 0), s(15, 6), s(39, 15), s(63, 26), s(77, 30)], seven: seven(30, 130), five: undefined, now: T0 + 77 * H, zone: fixedZone(0) })
  expect(wk.days.slice(4).reduce((n, d) => n + (d.pct ?? 0), 0)).toBeGreaterThan(70)
  const { values, guess, today, measured } = wk.daysDrawn
  expect(values.reduce<number>((n, v, i) => n + (guess[i] ? (v ?? 0) : 0), 0)).toBeLessThanOrEqual(70 + 1e-9)
  expect([today, measured, guess.slice(0, 4)]).toEqual([3, true, [false, false, false, false]])
  expect(wk.fiveHourWindow).toEqual({ values: [], nowAt: undefined, from: 0 })
})
test("a cell reads its rise from the slice before it, never from a sample several slices back", () => {
  // Tue 5%, then Thu 35%: Thursday's 30 points are two days of use, not one day's.
  const wk = weekOf({ samples: [s(0, 0), s(8, 5), s(61, 35)], seven: seven(35, 60), five: undefined, now: T0 + 62 * H, zone: fixedZone(0) })
  expect(marked(wk.days)).toBe('TW[T]FSSM')
  expect(wk.days.slice(0, 3).map(said)).toEqual(['5%', '', ''])
})
test('an hour cell reads its rise from the hour before it, never from one several hours back', () => {
  const five = { percentUsed: 40, projectedPct: undefined, resetsAt: T0 + 5 * H, gone: 0.7 }
  const wk = weekOf({ samples: [s(0, 0, 0), s(0.5, 0, 10), s(3.4, 0, 40)], seven: undefined, five, now: T0 + 3.5 * H, zone: fixedZone(0) })
  expect(wk.hours.map(said)).toEqual(['10%', '', '', '', ''])
})
test('a sample of one window cuts that window alone', () => {
  const week = (hours: number, sevenPct: number) => ({ at: T0 + hours * H, sevenPct, sevenResetAt: T0 + 168 * H })
  const five = { percentUsed: 40, projectedPct: undefined, resetsAt: T0 + 5 * H, gone: 0.5 }
  const wk = weekOf({ samples: [week(0, 0), week(15, 6), week(39, 15)], seven: seven(15, 30), five, now: T0 + 40 * H, zone: fixedZone(0) })
  expect(wk.days.slice(0, 3).map(said)).toEqual(['6%', '9%', ''])
})
