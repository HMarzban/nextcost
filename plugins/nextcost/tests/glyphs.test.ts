// The glyph tiers: which one a session picks, the ascii mapping, and chips drawn in it.

import { test, expect } from 'claude-code/testing'
import { ASCII_MAP, asciiText, resolveGlyphs } from '../hooks/glyphs'
import { makeKit } from '../hooks/kit'
import { ROW_SLACK } from '../hooks/layout'
import { readingsOf } from '../hooks/reading'
import { LAYOUT_NAMES } from '../hooks/snapshot'
import { cachePill } from '../hooks/views/chips'
import { ASCII_TIER, CALM_LIMITS, LAST_MINUTE_CACHE, bandOf, cacheWith, caseKey, cutBySurface, drawCases, kitOf, snapOf, type Mount } from './matrix'
import {
  BUILD_80K,
  HOUR_1,
  LONG,
  MIN,
  START,
  byKey,
  cards,
  fakeEl,
  firstRow,
  mountBand,
  pillOf,
  respond,
  segments,
  setup,
  shown,
  textOf,
  walk,
  widthOf,
} from './helpers'

test('unicode by default, ascii on request or in a CJK locale', () => {
  expect(resolveGlyphs({})).toBe('unicode')
  expect(resolveGlyphs({ NEXTCOST_GLYPHS: 'ascii' })).toBe('ascii')
  expect(resolveGlyphs({ LANG: 'ja_JP.UTF-8' })).toBe('ascii')
  expect(resolveGlyphs({ LANG: 'zh_CN.UTF-8', NEXTCOST_GLYPHS: 'unicode' })).toBe('unicode')
})
test('LC_CTYPE alone picks the ascii tier', () => {
  expect(resolveGlyphs({ LANG: 'C', LC_CTYPE: 'ko_KR.UTF-8' })).toBe('ascii')
  expect(resolveGlyphs({ LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'ja_JP.UTF-8' })).toBe('unicode') // LC_ALL wins
})
test('the ascii tier is drawn on a terminal alone', () => {
  expect(kitOf({ glyphs: 'ascii' }).glyphs).toBe('ascii')
  for (const surface of ['desktop', 'mobile', 'vscode'] as const) expect(kitOf({ surface, glyphs: 'ascii' }).glyphs).toBe('unicode')
})
test('the ascii tier never makes a row wider', () => {
  for (const [from, to] of Object.entries(ASCII_MAP)) expect([...to].length).toBeLessThanOrEqual([...from].length)
})
test('ascii text is pure ASCII, a dropped glyph takes its space, and padding stays', () => {
  expect(asciiText('◷ cache 52m · ↻ 3h 00m Σ 225k ↑2 ↓1 cache – ●… █░▒│▿▵■ ◔ ±')).toMatch(ASCII_TIER)
  expect(asciiText('◷ cache 52m')).toBe('cache 52m')
  expect(asciiText('↻ in 3h 00m')).toBe('in 3h 00m')
  expect(asciiText('█████╸ █│██╌╌')).toBe('#####> #|##~~') // a battery's cap, a notch and a projection
  expect(asciiText('cache 52m › 5h resets 3h 00m')).toBe('cache 52m > 5h resets 3h 00m')
  expect(asciiText('café latte')).toBe('caf latte') // an unmapped character goes alone
  expect(asciiText('cache      52m')).toBe('cache      52m')
})
test("a spaced separator reads as a comma, never as a minus between numbers", () => {
  expect(asciiText('input 196k · output 12k · cache reads 0')).toBe('input 196k, output 12k, cache reads 0')
  expect(asciiText('5h 4%·7d')).toBe('5h 4%-7d') // a bare one keeps its dash
})
test('chips in the ascii tier draws only ASCII, within the row, shut and open', LONG, async ($, on) => {
  const m: Mount = { surface: 'terminal', cols: 120 }
  const desktop: Mount = { surface: 'desktop', cols: 120 }
  const trees = await drawCases($, on, { scenario: 'calm', appearance: 'dark', env: { NEXTCOST_GLYPHS: 'ascii' } }, [m, desktop])
  const shut = trees[caseKey(m, 'shut')]
  const open = trees[caseKey(m, 'open')]
  expect(textOf(shut)).toMatch(ASCII_TIER)
  expect(widthOf(firstRow(shut))).toBeLessThanOrEqual(120 - ROW_SLACK)
  expect(byKey(shut, 'more', 'Button')?.props?.label).toBe('^')
  // Opened (by key), the band stays ASCII and keeps its cards, and the toggle reads v.
  expect(cards(open).length).toBeGreaterThan(0)
  expect(textOf(open)).toMatch(ASCII_TIER)
  expect(byKey(open, 'more', 'Button')?.props?.label).toBe('v')
  // The tier is the terminal's: the desktop draws its own glyphs.
  expect(byKey(trees[caseKey(desktop, 'shut')], 'more', 'Button')?.props?.label).toBe('▵')
})
test('the ascii battery drops its glyph before the cut, so its charge and spacing hold', LONG, async ($, on) => {
  const clock = setup(on, { env: { ...HOUR_1, NEXTCOST_GLYPHS: 'ascii' } })
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(52 * MIN) // 8 of the hour's 60 minutes left

  const ui = await mountBand($, 'terminal', 110)
  const seg = segments(pillOf(await ui.drawn(), 'cache'))
  const all = seg.map(x => x.text).join('')
  expect(all).toBe(' cache 8:00 ')
  expect(seg[0]?.text.length).toBe(Math.round((8 / 60) * all.length))
  await ui.unmount()
})

// Ink's cut adds U+2026, East-Asian-Ambiguous, which a CJK terminal draws two
// columns wide where Ink counts one: every narrow cut would overflow its row
// for the tier's main audience. The tree can't show a cut the surface makes
// as it draws, so no ascii Text may leave one to it.
for (const layout of LAYOUT_NAMES) {
  for (const scenario of ['calm', 'lastMinute'] as const) {
    test(`${layout} in the ascii tier never draws U+2026, shut or open, at any width from 20 to 200: ${scenario}`, LONG, async ($, on) => {
      const mounts: Mount[] = Array.from({ length: 181 }, (_, i) => ({ surface: 'terminal', cols: 20 + i }))
      const trees = await drawCases($, on, { scenario, appearance: 'dark', layout, env: { NEXTCOST_GLYPHS: 'ascii' } }, mounts)
      for (const [drawn, tree] of Object.entries(trees)) {
        let cut = 0
        walk(tree, n => {
          if (cutBySurface(n)) cut++
        })
        expect(`${drawn} ${textOf(tree).includes('…')} ${cut}`).toBe(`${drawn} false 0`)
      }
    })
  }
}
test('the ascii tier keeps a wide character, which it measures two columns, and still maps the ambiguous ones', () => {
  expect(asciiText('設計メモ · 機能/表示幅 │ ±3')).toBe('設計メモ, 機能/表示幅 | +3')
  expect(asciiText('한국어 프로젝트')).toBe('한국어 프로젝트')
})

// ---- the words the ascii tier keeps -------------------------------------------

const GIT = { branch: 'main', commit: undefined, worktree: undefined, changed: 3, ahead: 2, behind: 1 } as const
const ASCII_WORKSPACE = { path: '/u/nextcost', repoName: undefined, git: GIT }

test('the ASCII row says tok, ctx and resets where the unicode row has Σ, ◔ and ↻', () => {
  const row = (glyphs: 'ascii' | 'unicode') => shown(firstRow(bandOf({ glyphs, columns: 200, ...CALM_LIMITS })))
  const ascii = row('ascii')
  expect(ascii).toMatch(ASCII_TIER)
  expect(ascii).toMatch(/tok 225k/)
  expect(ascii).toMatch(/ctx .*40% full/)
  expect(ascii).toMatch(/5h .* \| resets 3h 00m/)
  expect(ascii).toMatch(/7d .* \| resets 2d 19h/)
  // The unicode tier is as it was.
  expect(row('unicode')).toMatch(/│ ↻ 3h 00m.*Σ 225k/)
})

test('the ASCII tier never draws a bare span after a bar, nor a bare token count, at any width', () => {
  for (const columns of [40, 60, 80, 100, 120, 160, 200]) {
    const text = shown(firstRow(bandOf({ glyphs: 'ascii', columns, ...CALM_LIMITS })))
    // A time after a bar's divider is a reset only if it says so.
    expect(`${columns} ${/\|\s*\d/.test(text)}`).toBe(`${columns} false`)
    if (/225k/.test(text)) expect(`${columns} ${/tok 225k/.test(text)}`).toBe(`${columns} true`)
  }
})

test('the short cache pill keeps the word cache in the ASCII tier, where the clock glyph was its only mark', () => {
  for (const cache of [LAST_MINUTE_CACHE, cacheWith({ leftMs: 0 }), cacheWith({ leftMs: 0, interrupted: 'compacted' })]) {
    const snap = snapOf({ glyphs: 'ascii', cache })
    const pill = cachePill(makeKit(fakeEl, snap), readingsOf(snap), true)
    expect(shown({ children: pill.body })).toMatch(/cache/)
  }
  // The long forms already say it once.
  const snap = snapOf({ glyphs: 'ascii', cache: LAST_MINUTE_CACHE })
  expect(shown({ children: cachePill(makeKit(fakeEl, snap), readingsOf(snap), false).body }).match(/cache/g)).toHaveLength(1)
})

test('the ASCII strip says ahead and behind, not +2 -1, which reads like a diff', () => {
  const strip = (glyphs: 'ascii' | 'unicode') => shown(byKey(bandOf({ glyphs, columns: 120, maxRows: 40, expanded: true, workspace: ASCII_WORKSPACE }), 'strip'))
  expect(strip('ascii')).toMatch(/ahead 2 behind 1$/)
  expect(strip('ascii')).toMatch(ASCII_TIER)
  expect(strip('unicode')).toMatch(/↑2 ↓1$/)
})
