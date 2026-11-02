// What the band says on screen is what is true: a guessed lifetime is marked
// and never cut, the next message's price says what it covers, the terminal's
// ASCII tier keeps its words, escalation always adds words or a mark, counts
// say when they began, and a percentage says what it is of.

import { test, expect } from 'claude-code/testing'
import { readingsOf } from '../hooks/reading'
import { PLAIN } from '../hooks/palette'
import { MIN, byKey, cardOf, fact, shown, wordsOf, type Node } from './helpers'
import { ASCII_TIER, LAST_MINUTE_CACHE, bandOf, cacheWith, snapOf } from './matrix'

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

void byKey
void ASCII_TIER
void (null as unknown as Node)
