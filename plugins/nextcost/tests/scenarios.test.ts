// Every scenario reaches the state its name says, shut and open, and one
// test's state never leaks into the next.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BUILD_155K, LONG, START, engine, mountBand, setup, shown, turn, respond } from './helpers'
import { caseKey, drawCases, ttlOf, type Mount, type ScenarioName } from './matrix'
import { treeHash } from './golden/hash'

const WIDE: Mount = { surface: 'terminal', cols: 160 }
const drawn = async ($: Engine, on: On, scenario: ScenarioName) => {
  const trees = await drawCases($, on, { scenario, appearance: 'dark', ttl: ttlOf(scenario) }, [WIDE])
  return { shut: shown(trees[caseKey(WIDE, 'shut')]), open: shown(trees[caseKey(WIDE, 'open')]) }
}
const reaches = (scenario: ScenarioName, shut: RegExp, open?: RegExp, notOpen?: RegExp) =>
  test(`${scenario} reaches its state, shut and open`, LONG, async ($, on) => {
    const t = await drawn($, on, scenario)
    expect(t.shut).toMatch(shut)
    if (open !== undefined) expect(t.open).toMatch(open)
    if (notOpen !== undefined) expect(t.open).not.toMatch(notOpen)
  })

reaches('calm', /cache 1h 00m/, /CACHE/)
reaches('unmeasured', /cache –/, /not measured yet/)
reaches('warming', /cache warming/, /CACHEwarming/)
reaches('recalled', /cache 40m/, /CACHE/)
reaches('cold', /cache cold/, /next message/)
reaches('lastMinute', /0:30 left · re-warm ~\$/)
reaches('working', /cache warm \$/)
reaches('nearCompaction', /compacts in ~10k/, /CONTEXT/)
reaches('compactionOff', /170k \/ 200k!/, /85%! full/)
reaches('limit80', /82%!/)
reaches('fiveHourAhead', /full in ~/)
reaches('sevenFullBeforeReset', /7d \S+ 79%/, /full at avg pace/)
reaches('noLimits', /\$2\.41/, /CACHE/, /LIMITS/)
reaches('gatewaySpend', /\$2\.41/, /spend 92%!/)
reaches('resetPassed', /5h reset/)
reaches('noWorkspace', /\$2\.41/, /CACHE/, /workspace\/nextcost/)
reaches('notARepo', /\$2\.41/, /workspace\/nextcost/, /on main/)
reaches('gitFails', /\$2\.41/, /workspace\/nextcost/, /on main/)
reaches('emptyHistory', /cache warming/)
reaches('fullHistory', /\$8\.41/)

// Module state carries across the tests of one file: session.start must reset it.
const calm: string[] = []
const twoMounts: Mount[] = [WIDE, { surface: 'desktop', cols: 120 }]
const calmHash = async ($: Engine, on: On) =>
  Object.values(await drawCases($, on, { scenario: 'calm', appearance: 'dark' }, twoMounts)).map(treeHash).join(' ')
test('a calm draw, before a cold one', async ($, on) => { calm.push(await calmHash($, on)) })
test('a cold draw, between two calm ones', LONG, async ($, on) => { expect((await drawn($, on, 'cold')).shut).toMatch(/cache cold/) })
test('a calm draw after a cold one is the same tree', async ($, on) => { expect(await calmHash($, on)).toBe(calm[0]) })

test('the fake engine counts store reads, store writes and invalidates', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  expect(engine.storeGets).toContain('sessions')
  await respond($, BUILD_155K)
  await turn($, 't1', 2.41, 2.62)
  await clock.settle()
  expect(engine.storeSets).toContain('sessions')
  expect(engine.invalidates).toBeGreaterThan(0)
})
test('a failing store refuses every write, and the band carries on', async ($, on) => {
  const clock = setup(on)
  engine.storeFails = true
  await $.session.start(START)
  await respond($, BUILD_155K)
  await turn($, 't1', 2.41, 2.62)
  await clock.settle()
  expect(engine.storeSets).toContain('sessions')
  expect('sessions' in engine.store).toBe(false)
  const ui = await mountBand($, 'terminal', 160)
  expect(shown(await ui.drawn())).toMatch(/\$2\.62/)
  await ui.unmount()
})
