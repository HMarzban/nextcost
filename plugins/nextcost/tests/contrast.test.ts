// Contrast: every ink the band draws against every ground it sits on, in
// each palette, to WCAG's text and non-text ratios; and the departures
// board's inks on its tiles.

import { test, expect } from 'claude-code/testing'
import { DARK, LIGHT } from '../hooks/palette'
import { DARK_HOSTS, LIGHT_HOSTS, contrast } from './helpers'

// Both palettes, every pair: a palette added later is checked by adding it here.
for (const [name, p, hosts] of [
  ['dark', DARK, DARK_HOSTS],
  ['light', LIGHT, LIGHT_HOSTS],
] as const) {
  const pillGrounds = [p.surface, p.amberBg, p.cardBg, p.fiveBg, p.weekBg]

  test(`${name}: labels and values meet WCAG text contrast on every surface they sit on`, () => {
    for (const bg of pillGrounds) expect(contrast(p.label, bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.cardValue, p.cardBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.value, p.cardBg)).toBeGreaterThanOrEqual(4.5)
  })

  test(`${name}: card edges and bar tracks meet WCAG non-text contrast`, () => {
    for (const host of hosts) expect(contrast(p.cardBorder, host)).toBeGreaterThanOrEqual(3)
    for (const bg of pillGrounds) expect(contrast(p.trackStroke, bg)).toBeGreaterThanOrEqual(3)
    // A text meter's empty cells (░), the cache's track (⣀) and an unmeasured
    // day's edge are the track itself, on every ground they sit on.
    const low = pillGrounds.filter(bg => contrast(p.trackInk, bg) < 3)
    expect(low.map(bg => `${p.trackInk} on ${bg} ${contrast(p.trackInk, bg).toFixed(2)}`)).toEqual([])
  })

  test(`${name}: a hover card is inverted, its ink legible and its ground apart from every chip's and the band's`, () => {
    expect(contrast(p.tooltipFg, p.tooltipBg)).toBeGreaterThanOrEqual(4.5)
    // A text surface's cards are drawn over chips' row and the workspace strip alone, so the
    // grounds they cover are the chips' and the host's.
    const covered = [...pillGrounds, p.meterTrack, p.trackInk, p.batteryFill, p.batteryAmber, ...hosts]
    const low = covered.filter(bg => contrast(p.tooltipBg, bg) < 3)
    expect(low.map(bg => `${bg} ${contrast(p.tooltipBg, bg).toFixed(2)}`)).toEqual([])
  })

  test(`${name}: the layouts' text and marks hold on the card ground`, () => {
    expect(contrast(p.amberFg, p.cardBg)).toBeGreaterThanOrEqual(4.5)
    for (const mark of [p.meterFill, p.warm, p.fiveAccent, p.weekAccent]) expect(contrast(mark, p.cardBg)).toBeGreaterThanOrEqual(3)
    expect(contrast(p.value, p.surface)).toBeGreaterThanOrEqual(4.5)
  })

  test(`${name}: a value holds as text on a window's tint`, () => {
    for (const bg of [p.fiveBg, p.weekBg]) expect(contrast(p.value, bg)).toBeGreaterThanOrEqual(4.5)
  })

  test(`${name}: every role a layout's words take is text that holds on the card ground`, () => {
    const low = (['label', 'value', 'cardValue', 'amberFg'] as const).filter(ink => contrast(p[ink], p.cardBg) < 4.5)
    expect(low.map(ink => `${ink} ${contrast(p[ink], p.cardBg).toFixed(2)}`)).toEqual([])
  })
}

// ── the departures board ───────────────────────────────────────────────

const BOARD_INKS = ['flapItemCache', 'flapItemSpend', 'flapItemContext', 'flapItem5h', 'flapItem7d', 'flapText', 'flapDim', 'flapAmber'] as const
test('the board is dark in dark and light alike, and every ink reads on its tiles', () => {
  for (const p of [DARK, LIGHT]) for (const ink of BOARD_INKS) expect(contrast(p[ink], p.flapBg)).toBeGreaterThanOrEqual(4.5)
  for (const k of ['boardBg', 'flapBg', 'flapSeam', ...BOARD_INKS] as const) expect(LIGHT[k]).toBe(DARK[k])
  // The seam is decoration (the three-layouts spec §5.1): it differs from the tile, with no contrast target.
  expect(DARK.flapSeam).not.toBe(DARK.flapBg)
  expect(DARK.flapItem5h).toBe(DARK.fiveAccent)
  expect(DARK.flapItem7d).toBe(DARK.weekAccent)
})
