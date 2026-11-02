// A response with a large prompt that read and wrote no cache: caching is off
// (DISABLE_PROMPT_CACHING, a gateway stripping the markers, a model without
// it), so no cache exists to count down or re-warm. Below the largest minimum
// the API's docs list, 4,096 tokens, reading and writing none is expected.

import { test, expect, type Engine } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { LAYOUT_NAMES } from '../hooks/snapshot'
import { LONG, MIN, START, resp, respond, setup, shutAndOpen, svgAlts, textOf } from './helpers'
import { cacheView } from './matrix'

// The desktop's flap tiles say it in their alts.
const said = (tree: unknown): string => `${textOf(tree)}\n${svgAlts(tree).join('\n')}`

const shutAndOpenSaid = async ($: Engine, surface: 'terminal' | 'desktop'): Promise<string> => {
  const { shut, open } = await shutAndOpen($, 160, surface)
  return `${said(shut)}\n${said(open)}`
}

const NO_COUNTDOWN = /\d+m left|re-warm|RE-WARM|DEPARTS|LAST CALL|BOARDING|CHECK-IN|\dh idle|next message|\bcache \d/

for (const layout of LAYOUT_NAMES)
  for (const surface of ['terminal', 'desktop'] as const)
    test(`${layout} on the ${surface} says not caching, with no countdown or price`, LONG, async ($, on) => {
      const clock = setup(on, { store: { layout } })
      await $.session.start({ ...START, surface })
      await respond($, resp(157_000, 0, 0, 500))
      await clock.advance(MIN)
      const text = await shutAndOpenSaid($, surface)
      expect(text.toLowerCase()).toContain('not caching')
      expect(text).not.toMatch(NO_COUNTDOWN)
    })

const afterOne = (input: number) => {
  const c = newCache()
  c.responded(resp(input, 0, 0, 10), 0, true)
  return cacheView(c, MIN)
}

test('the threshold is the largest minimum the docs list: 4,096 tokens may be below a model\'s minimum, more is not', () => {
  expect(afterOne(4_096).interrupted).toBe(undefined)
  expect(afterOne(4_097).interrupted).toBe('uncached')
})

test('no time is left to count, so the timer has nothing to repaint', () => {
  const cache = afterOne(157_000)
  expect([cache.leftMs, cache.coldAt]).toEqual([0, null])
})

test('a first request that builds the cache, and a small prompt, still count down', () => {
  const built = newCache()
  built.responded(resp(2_000, 0, 80_000, 10), 0, true)
  expect(cacheView(built, MIN).interrupted).toBe(undefined)
  expect(afterOne(900).leftMs).toBeGreaterThan(0)
})

test('a reply with cache tokens ends it, and the countdown starts', () => {
  const c = newCache()
  c.responded(resp(157_000, 0, 0, 10), 0, true)
  c.responded(resp(100, 0, 157_000, 10), MIN, true)
  const cache = cacheView(c, MIN)
  expect([cache.interrupted, cache.leftMs]).toEqual([undefined, 60 * MIN])
  expect(c.turnEnded(undefined).rebuilt).toBe(false)
})

test('caching going off is no miss, no rebuild and no five-minute cache', () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 150_000, 10), 0, true)
  c.responded(resp(152_000, 0, 0, 10), 12 * MIN, true)
  const cache = cacheView(c, 12 * MIN)
  expect([cache.misses, cache.ttl]).toEqual([0, '1h'])
  expect(c.turnEnded(undefined).rebuilt).toBe(false)
})

test('a subagent that caches nothing says nothing of the main cache', () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 150_000, 10), 0, true)
  c.responded(resp(50_000, 0, 0, 10), MIN, false)
  expect(cacheView(c, MIN).interrupted).toBe(undefined)
})
