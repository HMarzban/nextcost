// A provider's id for a model, and the kinds of name that aren't one: what the
// band prices a read and a request by, and which rate a stored one is found under.

import { test, expect } from 'claude-code/testing'
import { fromStore, recallOf } from '../hooks/memory'
import { readMultiplier, tierFactor } from '../hooks/prices'

test("a provider's id for a model prices as the model", () => {
  for (const id of ['us.anthropic.claude-opus-5-5-v1:0', 'global.anthropic.claude-opus-5-5-v1:0', 'anthropic.claude-opus-5-5-v1:0', 'claude-opus-5-5@20261001', 'claude-opus-5-5-20261001', 'us.anthropic.claude-opus-5-5-20261001-v1:0', 'us.anthropic.claude-opus-5-5-v1:0[1m]', 'claude-opus-5-5']) {
    expect(readMultiplier(id)).toBe(0.05)
  }
  for (const id of ['us.anthropic.claude-haiku-5-5-v1:0', 'claude-haiku-5-5@20261001', 'claude-haiku-5-5-20261001']) {
    expect(tierFactor(id, 100_001)).toBe(5)
    expect(tierFactor(id, 100_000)).toBe(1)
  }
  expect(readMultiplier('us.anthropic.claude-fable-5-1-v1:0')).toBe(0.025)
})

test("a name that isn't a provider's form stays as it is", () => {
  expect(readMultiplier('claude-opus-5-5-preview')).toBe(0.1)
  expect(readMultiplier('claude-opus-5-5-2026')).toBe(0.1)
  expect(readMultiplier('my-opus-gateway')).toBe(0.1)
  expect(tierFactor('claude-opus-5-5@20261001', 900_000)).toBe(1)
})

test('a stored rate under a provider id is found again under that id', () => {
  const id = 'us.anthropic.claude-opus-5-5-v1:0'
  const stored = fromStore({ sessions: { s1: { lastAt: 5, billed: id } }, rates: { [id]: 4e-6 } }, 's1', 'opus', 10)
  expect(recallOf(stored, undefined, 10).rate).toBe(4e-6)
})
