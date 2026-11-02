// The snapshot a band is drawn from, built from its parts: the mount spread,
// the band's own choices, the context with where it compacts, and the cache
// and the insights as they stand. How it reads the limits: limits.test.ts.

import { test, expect } from 'claude-code/testing'
import { fixedZone } from '../hooks/format'
import { PLAIN } from '../hooks/palette'
import { resetsOf, snapshotOf } from '../hooks/snapshot'
import { MIN, SAMPLES, USAGE } from './helpers'
import { COLD_CACHE, HISTORY, SNAP_PARTS, WORKSPACE } from './matrix'

test('a snapshot is its mount, its band, the cache and the insights, as given', () => {
  const zone = fixedZone(60)
  const built = snapshotOf({
    ...SNAP_PARTS,
    now: 5 * MIN,
    mount: { surface: 'desktop', columns: 95, maxRows: 8, isWorking: true },
    expanded: true,
    band: { ...SNAP_PARTS.band, palette: PLAIN, layout: 'pulse', glyphs: 'ascii', samples: SAMPLES, workspace: WORKSPACE },
    cache: COLD_CACHE,
    costUsd: 4.2,
    history: HISTORY,
    zone,
  })
  expect(built).toMatchObject({
    surface: 'desktop', columns: 95, maxRows: 8, isWorking: true, expanded: true, now: 5 * MIN,
    palette: PLAIN, layout: 'pulse', glyphs: 'ascii', samples: SAMPLES, workspace: WORKSPACE, costUsd: 4.2,
  })
  expect([built.cache, built.history, built.zone]).toEqual([COLD_CACHE, HISTORY, zone])
})

test("the context is the engine's, with where the band found it compacts, or that compaction is off", () => {
  expect(snapshotOf(SNAP_PARTS).context).toEqual({ tokens: 76_000, window: 200_000, percent: 38, compactAt: 190_000 })
  const off = snapshotOf({ ...SNAP_PARTS, usage: { ...USAGE, context: { window: 200_000 } }, band: { ...SNAP_PARTS.band, compactAt: undefined } })
  expect(off.context).toEqual({ tokens: undefined, window: 200_000, percent: undefined, compactAt: undefined })
})

test('with no window reported there is no 5h, 7d or other limit, and the pace is dropped with the 5h', () => {
  const none = snapshotOf({ ...SNAP_PARTS, usage: { ...USAGE, rateLimits: [] }, etaMs: 40 * MIN })
  expect([none.fiveHour, none.sevenDay, none.otherLimits, resetsOf(none)]).toEqual([undefined, undefined, [], []])
})
