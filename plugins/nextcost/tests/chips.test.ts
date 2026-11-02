// Chips' row as its board draws it: the pills in order, one bold per
// reading, a limit's reset in label ink.

import { test, expect } from 'claude-code/testing'
import { makeKit } from '../hooks/kit'
import { DARK } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { chipsView } from '../hooks/views/chips'
import { drawView } from '../hooks/views/frame'
import { HOUR, MIN, boldOf, byKey, fakeEl, firstRow, pillKeys, shown, type Node } from './helpers'
import { NO_ACT, snapOf } from './matrix'

const rowOf = (over: Partial<BandSnapshot> = {}): Node => {
  const snap = snapOf({ columns: 200, ...over })
  return firstRow(drawView(chipsView, makeKit(fakeEl, snap), readingsOf(snap), NO_ACT)) as Node
}

test('the pills run cache, cost, context, 5h and 7d, then the tokens, first to give way', () => {
  expect(pillKeys(rowOf())).toEqual(['cache', 'cost', 'ctx', '5h', '7d', 'tokens'])
})
test("a limit's reset reads in label ink, its pace in its tint, and only its figure is bold", () => {
  const row = rowOf({ fiveHour: { percentUsed: 84, resetsAt: 70 * MIN, etaMs: 40 * MIN } })
  const five = byKey(row, '5h', 'Box')
  expect(boldOf(five)).toEqual([' 84%!'])
  expect(shown(byKey(five, 'p', 'Text'))).toBe(' full in ~40m')
  const seven = byKey(row, '7d', 'Box')
  expect([shown(byKey(seven, 'r', 'Text')), byKey(seven, 'r', 'Text')?.props?.color]).toEqual(['2d 19h', DARK.label])
  expect(byKey(seven, 'i-reset', 'Text')?.props?.color).toBe(DARK.label)
})
test("on the desktop a limit's reset is ↻ and its time, the glyph in label grey, as the board draws it, never the clock icon", () => {
  const row = rowOf({ surface: 'desktop' })
  for (const key of ['5h', '7d']) {
    const pill = byKey(row, key, 'Box')
    expect(shown(pill)).toMatch(/│ ↻ \d/)
    expect(byKey(pill, 'i-reset', 'Text')?.props?.color).toBe(DARK.label)
    expect(byKey(pill, 'i-reset', 'Svg')).toBeUndefined()
  }
})

// The fill a pace forecasts is never a bare span beside the reset, where it
// reads as when the window resets: `5h 76% ~1h 15m` beside `Resets in 2h`.
const PACING = { fiveHour: { percentUsed: 76, resetsAt: 2 * HOUR, etaMs: 75 * MIN } }

test("a limit's pace, cut short, still says it is when the window fills", () => {
  const short = byKey(rowOf({ columns: 60, ...PACING }), '5h', 'Box')
  expect(shown(byKey(short, 'p', 'Text'))).toBe(' full ~1h 15m')
  const long = byKey(rowOf(PACING), '5h', 'Box')
  expect(shown(byKey(long, 'p', 'Text'))).toBe(' full in ~1h 15m')
})

test("a limit's hover says its fill is a projection at the current pace", () => {
  expect(readingsOf(snapOf(PACING)).chips.limitHover['5h']).toBe(
    'Resets in 2h 00m; 5-hour limit, all your Claude use; full in ~1h 15m at the current pace; as of your last reply',
  )
  // With no fill forecast, the hover is as it was.
  expect(readingsOf(snapOf()).chips.limitHover['5h']).toBe('Resets in 3h 00m; 5-hour limit, all your Claude use; as of your last reply')
})
