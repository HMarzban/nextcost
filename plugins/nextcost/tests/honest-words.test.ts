// What the band says on screen is what is true: a guessed lifetime is marked
// and never cut, the next message's price says what it covers, counts say when
// they began, and a percentage says what it is of. The board's words are
// board-words.test.ts's, the ASCII tier's glyphs.test.ts's.

import { test, expect } from 'claude-code/testing'
import { readingsOf } from '../hooks/reading'
import { MIN, byKey, cardOf, fact, factsOf, shown } from './helpers'
import { NEAR_COMPACTION, SNAP_PARTS, bandOf, cacheWith, snapOf } from './matrix'
import type { BandSnapshot } from '../hooks/snapshot'

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
const GUESSED = cacheWith({ ttlKnown: false })
const WOKEN = { misses: 1, wake: { by: 'task', reWarm: false } } as const

test('a guessed hour is marked in the warm hover, in both of its branches and when expiring', () => {
  expect(readingsOf(snapOf({ cache: GUESSED })).chips.cache.hover).toBe('52m left (assumed 1h lifetime); warm cache bills input at 5%')
  const compact = readingsOf(snapOf({ cache: { ...GUESSED, idleCompacts: true, leftMs: 50 * MIN } })).chips.cache.hover
  expect(compact).toBe('50m left (assumed); may be compacted at ~54m idle, before it goes cold')
  expect(readingsOf(snapOf({ cache: { ...GUESSED, leftMs: 30_000 } })).chips.cache.hover).toMatch(/^0:30 left \(assumed\); /)
  // A pin or a read says nothing of a guess; an inferred 5m is one.
  expect(readingsOf(snapOf()).chips.cache.hover).not.toMatch(/assumed/)
  expect(readingsOf(snapOf({ cache: cacheWith({ ttlKnown: false, ttl: '5m' }) })).chips.cache.hover).toMatch(/assumed 5m/)
})

test('a guessed hour is the second fact of the Cache card, above everything droppable; a known one stays last', () => {
  const rows = (cache: BandSnapshot['cache']) => factsOf(cardOf(bandOf({ columns: 100, maxRows: 40, expanded: true, cache }), 'cache'))
  expect(rows({ ...GUESSED, ...WOKEN }).slice(0, 2)).toEqual(['re-warm if cold', 'expires'])
  expect(rows({ ...SNAP_PARTS.cache, ...WOKEN }).at(-1)).toBe('expires')
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
  expect(hover(cacheWith({ leftMs: 0 }))).toBe('Cold: ~$1.66 rewrites 155k tokens to the cache, plus your reply')
  expect(hover({ ...cacheWith({ leftMs: 0 }), reWarmUsd: null })).toBe('Cold: next message rewrites 155k tokens to the cache, plus your reply')
  expect(hover(cacheWith({ leftMs: 0, interrupted: 'compacted', compactedIdle: true }))).toBe('Compacted while idle: ~$1.66 rewrites the 155k summary, plus your reply')
  expect(hover(cacheWith({ leftMs: 30_000 }))).toBe('0:30 left; if cold, ~$1.66 rewrites the cache, plus your reply')
  // A warm pill shows no price, so its hover names none.
  expect(hover(cacheWith({}))).not.toMatch(/rewrite|extra/)
})

test('every hover is one line a terminal row keeps whole: the price and a guess stay inside the budget', () => {
  const hovers = (over: Partial<BandSnapshot>) => {
    const r = readingsOf(snapOf(over))
    return [r.chips.cache.hover, r.chips.contextHover, r.chips.tokensHover]
  }
  const cases: Array<[string, Partial<BandSnapshot>]> = [
    ['warm', {}],
    ['warm, assumed', { cache: GUESSED }],
    ['idle-compactable, assumed', { cache: { ...GUESSED, idleCompacts: true, leftMs: 50 * MIN } }],
    ['expiring, assumed', { cache: { ...GUESSED, leftMs: 30_000 } }],
    ['cold', { cache: cacheWith({ leftMs: 0 }) }],
    ['compacted', { cache: cacheWith({ leftMs: 0, interrupted: 'compacted' }) }],
    ['near compaction', { context: NEAR_COMPACTION }],
    ['under way', { cache: cacheWith({ fresh: false, recovered: false }) }],
  ]
  for (const [name, over] of cases) for (const hover of hovers(over)) expect(`${name} ${hover.length <= 72} ${hover}`).toBe(`${name} true ${hover}`)
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

// ---- counts say when they began ---------------------------------------------

/** Loaded into a conversation already under way: its cost is the engine's whole ledger, its tokens only the band's own. */
const UNDER_WAY = cacheWith({ fresh: false, recovered: false, requests: 2, misses: 1 })

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
  const spend = factsOf(cardOf(open(UNDER_WAY), 'spend'))
  expect(spend).toEqual(['counted since the band loaded', 'input', 'output', 'cache reads'])
  const cache = factsOf(cardOf(open(UNDER_WAY), 'cache'))
  expect(cache.slice(cache.indexOf('counted since the band loaded'))).toEqual(['counted since the band loaded', 'unexpected rebuilds', 'saved on cache reads', 'hit rate', 'expires'])
  expect(factsOf(cardOf(open(cacheWith({})), 'spend')).join()).not.toMatch(/since/)
  for (let maxRows = 6; maxRows <= 30; maxRows++)
    for (const name of ['spend', 'cache']) {
      const rows = factsOf(cardOf(open(UNDER_WAY, maxRows), name))
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
  expect(hover(snapOf().context)).toBe('76k of 190k (40%) toward compaction; window 200k; compacts in ~114k')
  expect(hover({ ...snapOf().context, compactAt: undefined })).toBe('76k of 200k (38%); older turns get summarized near full')
})
