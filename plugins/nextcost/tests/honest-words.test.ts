// What the band says on screen is what is true: a guessed lifetime is marked
// and never cut, the next message's price says what it covers, the terminal's
// ASCII tier keeps its words, escalation always adds words or a mark, counts
// say when they began, and a percentage says what it is of.

import { test, expect } from 'claude-code/testing'
import { readingsOf } from '../hooks/reading'
import { PLAIN } from '../hooks/palette'
import { MIN, byKey, cardOf, fact, fakeEl, firstRow, shown, walk, wordsOf, type Node } from './helpers'
import { makeKit } from '../hooks/kit'
import { cachePill } from '../hooks/views/chips'
import { ASCII_TIER, CALM_LIMITS, LAST_MINUTE_CACHE, NEAR_COMPACTION, SNAP_PARTS, bandOf, cacheWith, snapOf } from './matrix'
import type { BandSnapshot } from '../hooks/snapshot'

// ---- the departures board: an amber last call carries its mark ----------------

const CALM_LAST_CALL = cacheWith({ ttl: '1h', leftMs: 5 * MIN, coldAt: 5 * MIN })

test('the board: the last minute is `! LAST CALL`, the calm last call has no mark', () => {
  const amber = readingsOf(snapOf({ cache: LAST_MINUTE_CACHE })).board().rows[0]
  expect([amber?.status, amber?.cell, amber?.cellShort]).toEqual(['! LAST CALL', '! LAST CALL 30S', '! 30S'])
  const calm = readingsOf(snapOf({ cache: CALM_LAST_CALL })).board().rows[0]
  expect([calm?.status, calm?.tone]).toEqual(['LAST CALL', 'calm'])
  expect(calm?.cell.startsWith('!')).toBe(false)
})

test('plain has no hue, so the amber last call says its mark in the collapsed row and the open board', () => {
  for (const expanded of [false, true]) {
    const tree = bandOf({ layout: 'departures', palette: PLAIN, columns: 120, expanded, cache: LAST_MINUTE_CACHE })
    expect(wordsOf(tree)).toMatch(/CACHE\W*! LAST CALL \d+S/)
  }
})

// ---- the card says what the saved figure is --------------------------------

test('the Cache card calls the saved figure what it is: reads at a discount, not the cache net of its writes', () => {
  const tree = bandOf({ layout: 'chips', columns: 120, maxRows: 40, expanded: true })
  expect(fact(tree, 'saved on cache reads')).toBe('~$11.40')
  expect(fact(tree, 'saved by cache')).toBeUndefined()
})

// ---- a message that is not a session -----------------------------------------

test("a peer's message is `a message`, never `another session`: the band cannot always tell", () => {
  const kept = readingsOf(snapOf({ cache: cacheWith({ wake: { by: 'session', reWarm: false } }) }))
  expect(kept.cache.wakeRow).toEqual({ label: 'kept warm by', value: 'message' })
  expect(kept.cache.wakeShort).toBe('by message')
  expect(kept.chips.cache.hover).toMatch(/; a message kept it warm$/)
  const gone = readingsOf(snapOf({ cache: cacheWith({ leftMs: 0, wake: { by: 'session', reWarm: false } }) }))
  expect(gone.cache.wakeRow).toEqual({ label: 'last turn by', value: 'message' })
  expect(gone.chips.cache.hover).toMatch(/; last turn by a message$/)
  expect(gone.board().rows[0]?.woken?.[0]).toMatch(/^LAST TURN BY MESSAGE/)
  const card = shown(cardOf(bandOf({ cache: cacheWith({ wake: { by: 'session', reWarm: false } }), maxRows: 40, expanded: true }), 'cache'))
  expect(card).not.toMatch(/another session/)
})

// ---- a guessed lifetime is never cut --------------------------------------------

/** A cache whose lifetime is the hour assumed, neither pinned nor read. */
const GUESSED = cacheWith({ ttlPinned: false })
const WOKEN = { misses: 1, wake: { by: 'task', reWarm: false } } as const

/** The keys of a card's fact rows, in the order drawn. */
const factKeys = (card: Node | undefined): string[] => {
  const keys: string[] = []
  walk(card, n => {
    const key = n.props?.key
    if (typeof key === 'string' && key.startsWith('fact:')) keys.push(key)
  })
  return keys
}

test('a guessed hour is marked in the warm hover, in both of its branches and when expiring', () => {
  expect(readingsOf(snapOf({ cache: GUESSED })).chips.cache.hover).toBe('52m left (1h lifetime assumed); warm cache bills input at 5%, expires 1h after a request')
  const compact = readingsOf(snapOf({ cache: { ...GUESSED, idleCompacts: true, leftMs: 50 * MIN } })).chips.cache.hover
  expect(compact).toMatch(/^50m left \(1h lifetime assumed\); may be compacted at ~54m idle/)
  expect(readingsOf(snapOf({ cache: { ...GUESSED, leftMs: 30_000 } })).chips.cache.hover).toMatch(/^0:30 left \(1h lifetime assumed\); /)
  // A pin or a read says nothing of a guess; nor does the 5m cache, which is never assumed.
  expect(readingsOf(snapOf()).chips.cache.hover).not.toMatch(/assumed/)
  expect(readingsOf(snapOf({ cache: cacheWith({ ttlPinned: false, ttl: '5m' }) })).chips.cache.hover).not.toMatch(/assumed/)
})

test('a guessed hour is the second fact of the Cache card, above everything droppable; a known one stays last', () => {
  const rows = (cache: BandSnapshot['cache']) => factKeys(cardOf(bandOf({ columns: 100, maxRows: 40, expanded: true, cache }), 'cache'))
  expect(rows({ ...GUESSED, ...WOKEN }).slice(0, 2)).toEqual(['fact:re-warm if cold', 'fact:expires'])
  expect(rows({ ...SNAP_PARTS.cache, ...WOKEN }).at(-1)).toBe('fact:expires')
})

test('at every height the card draws, a guessed hour is said: as a row, else by the headline', () => {
  let drawn = 0
  for (const columns of [40, 60, 100, 133, 200])
    for (const surface of ['terminal', 'desktop'] as const)
      for (let maxRows = 6; maxRows <= 30; maxRows++) {
        const card = cardOf(bandOf({ surface, columns, maxRows, expanded: true, cache: GUESSED }), 'cache')
        if (card === undefined) continue
        drawn++
        const at = `${surface} ${columns}x${maxRows}`
        expect(`${at} ${/assumed/.test(shown(card))}`).toBe(`${at} true`)
      }
  expect(drawn).toBeGreaterThan(50)
})

// ---- the next message's price says what it covers -----------------------------

test('the hovers say the price is the cache rewrite, and what comes on top', () => {
  const hover = (cache: BandSnapshot['cache']) => readingsOf(snapOf({ cache })).chips.cache.hover
  expect(hover(cacheWith({ leftMs: 0 }))).toBe('Cold: next message rewrites 155k tokens to the cache (~$1.66); your message and its reply cost extra')
  expect(hover({ ...cacheWith({ leftMs: 0 }), reWarmUsd: null })).toBe('Cold: next message rewrites 155k tokens to the cache; your message and its reply cost extra')
  expect(hover(cacheWith({ leftMs: 0, compacted: true }))).toBe(
    'Compacted while idle: next message writes the 155k summary to the cache (~$1.66); your message and its reply cost extra',
  )
  expect(hover(cacheWith({ leftMs: 30_000 }))).toMatch(/^0:30 left; if it goes cold, ~\$1\.66 rewrites the cache, and your message and its reply cost extra; warm cache bills input at 5%/)
  // A warm pill shows no price, so its hover names none.
  expect(hover(cacheWith({}))).not.toMatch(/rewrite|extra/)
})

test('the estimate row says what it covers where the card has room, and never wraps where it has not', () => {
  const read = readingsOf(snapOf({ cache: cacheWith({ leftMs: 0 }) }))
  expect(read.cache.estimateForms).toEqual([
    '~$1.66 · cache rewrite, not your reply',
    '~$1.66 · cache rewrite only',
    '~$1.66 · cache rewrite',
    '~$1.66 · cache only',
    '~$1.66',
  ])
  const at = (layout: 'chips' | 'pulse', columns: number, label: string) =>
    fact(byKey(bandOf({ layout, surface: 'terminal', columns, maxRows: 40, expanded: true, cache: cacheWith({ leftMs: 0 }) }), layout === 'chips' ? 'card:cache' : 'pulse:cache', 'Box'), label)
  for (const layout of ['chips', 'pulse'] as const) {
    expect(at(layout, 120, 'next message')).toBe('~$1.66 · cache rewrite, not your reply')
    expect(at(layout, 80, 'next message')).toBe('~$1.66 · cache rewrite')
    expect(at(layout, 40, 'next message')).toBe('~$1.66 · cache rewrite')
  }
})

test("the board's REMARKS say the price is the cache rewrite; its collapsed cell is as short as ever", () => {
  const cold = readingsOf(snapOf({ cache: cacheWith({ leftMs: 0, coldAt: 0 }) })).board().rows[0]
  expect(cold?.remarks).toBe('RE-WARM ~$1.66 · CACHE REWRITE, NOT YOUR REPLY')
  expect(cold?.cell).toBe('DEPARTED · RE-WARM ~$1.66')
  expect(cold?.cellShort).toBe('RE-WARM ~$1.66')
  const warm = readingsOf(snapOf({ cache: cacheWith({ coldAt: 52 * MIN }) })).board().rows[0]
  expect(warm?.remarks).toMatch(/RE-WARM ~\$1\.66 IF MISSED · CACHE REWRITE, NOT YOUR REPLY$/)
})

// ---- counts say when they began ---------------------------------------------

/** Loaded into a conversation already under way: its cost is the engine's whole ledger, its tokens only the band's own. */
const UNDER_WAY = cacheWith({ fresh: false, recovered: false, requests: 2, misses: 1 })
const factsAndNotes = (card: Node | undefined): string[] => {
  const out: string[] = []
  walk(card, n => {
    const key = n.props?.key
    if (typeof key === 'string' && (key.startsWith('fact:') || key === 'note')) out.push(key === 'note' ? shown(n) : key.slice(5))
  })
  return out
}

test('the tokens hover says since the band loaded, only where the counts started there', () => {
  const hover = (cache: BandSnapshot['cache']) => readingsOf(snapOf({ cache })).chips.tokensHover
  expect(hover(UNDER_WAY)).toBe('input 18k · output 9.0k · cache reads 198k · since the band loaded')
  // A conversation that began here, or whose transcript was read, counts every token.
  expect(hover(cacheWith({}))).toBe('input 18k · output 9.0k · cache reads 198k')
  expect(hover({ ...UNDER_WAY, recovered: true })).not.toMatch(/since/)
  expect(readingsOf(snapOf({ cache: UNDER_WAY })).cache.sinceLoaded).toBe(true)
})

test('the Spend and Cache cards say it above the rows it covers, so none of them shows without it', () => {
  const open = (cache: BandSnapshot['cache'], maxRows = 40) => bandOf({ columns: 100, maxRows, expanded: true, cache })
  const spend = factsAndNotes(cardOf(open(UNDER_WAY), 'spend'))
  expect(spend).toEqual(['counted since the band loaded', 'input', 'output', 'cache reads'])
  const cache = factsAndNotes(cardOf(open(UNDER_WAY), 'cache'))
  expect(cache.slice(cache.indexOf('counted since the band loaded'))).toEqual(['counted since the band loaded', 'unexpected rebuilds', 'saved on cache reads', 'hit rate', 'expires'])
  expect(factsAndNotes(cardOf(open(cacheWith({})), 'spend')).join()).not.toMatch(/since/)
  for (let maxRows = 6; maxRows <= 30; maxRows++)
    for (const name of ['spend', 'cache']) {
      const rows = factsAndNotes(cardOf(open(UNDER_WAY, maxRows), name))
      const counted = rows.findIndex(r => ['input', 'unexpected rebuilds', 'saved on cache reads', 'hit rate'].includes(r))
      const said = rows.indexOf('counted since the band loaded')
      if (counted >= 0) expect(`${name} ${maxRows} ${said >= 0 && said < counted}`).toBe(`${name} ${maxRows} true`)
    }
})

// ---- a percentage says what it is of --------------------------------------------

test('pulse names what its context percentage is of, and chips\' hover names both numbers', () => {
  const head = (over: Partial<BandSnapshot>) => shown(byKey(byKey(bandOf({ layout: 'pulse', columns: 100, maxRows: 40, expanded: true, ...over }), 'pulse:context', 'Box'), 'head', 'Box'))
  expect(head({})).toBe('CONTEXT40% toward compaction')
  expect(head({ context: NEAR_COMPACTION })).toBe('CONTEXT! 95% toward compaction')
  // With compaction off the percentage is of the window, which the fact beside it says.
  expect(head({ context: { ...snapOf().context, tokens: 170_000, window: 200_000, percent: 85, compactAt: undefined, autoCompactOff: true } })).toBe('CONTEXT! 85%! full')
  const hover = (context: BandSnapshot['context']) => readingsOf(snapOf({ context })).chips.contextHover
  expect(hover(snapOf().context)).toBe('76k of the 190k auto-compaction point (40%); model window 200k; auto-compacts in ~114k')
  expect(hover({ ...snapOf().context, compactAt: undefined })).toBe('76k of 200k (38%); older turns get summarized near full')
})

test("the board's REMARKS say a calm context percentage is toward compaction; without compaction it is used of the window", () => {
  const row = (context: BandSnapshot['context']) => readingsOf(snapOf({ context })).board().rows.find(r => r.key === 'context')
  expect([row(snapOf().context)?.status, row(snapOf().context)?.remarks]).toEqual(['40% USED', 'TOWARD COMPACTION AT 190K · ~114K LEFT'])
  expect([row({ ...snapOf().context, compactAt: undefined })?.status, row({ ...snapOf().context, compactAt: undefined })?.remarks]).toEqual(['38% USED', ''])
})

// ---- the ASCII tier keeps its words -------------------------------------------

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
  for (const cache of [LAST_MINUTE_CACHE, cacheWith({ leftMs: 0 }), cacheWith({ leftMs: 0, compacted: true })]) {
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
