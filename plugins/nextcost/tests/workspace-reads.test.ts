// When the band asks git: at start, after each main turn and on opening the
// cards; never while it draws, and never in a way that can break the band.

import { test, expect } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import { CLEAR, GIT_CLEAN, GIT_MAIN_TREE, START, byKey, engine, runCommand, shown, turn, setup, mountBand } from './helpers'

const gitRuns = () => engine.ran.filter(argv => argv[0] === 'git').length

test("at start the band asks git twice, by fixed commands: its status, never taking the index lock or running a repo's fsmonitor, and where its folders are", async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  expect(engine.ran).toContainEqual(['git', '-c', 'core.fsmonitor=false', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
  expect(engine.ran).toContainEqual(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'])
})

test('drawing never runs git', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  const before = gitRuns()
  const ui = await mountBand($, 'desktop', 110)
  for (let i = 0; i < 3; i++) await ui.drawn()
  expect(gitRuns()).toBe(before)
  await ui.unmount()
})

test("a main turn reads git again; a subagent's turn doesn't", async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  const start = gitRuns()
  await turn($, 't1', 0, 0.1, { agentId: 'agent-1' })
  await clock.settle()
  expect(gitRuns()).toBe(start)
  await turn($, 't2', 0.1, 0.2)
  await clock.settle()
  expect(gitRuns()).toBe(start + 2)
})

test('opening the cards reads git again, so they never show a stale branch', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'desktop', 110)
  await clock.settle()
  const closed = gitRuns()
  await ui.press({ key: 'more' })
  await clock.settle()
  expect(gitRuns()).toBe(closed + 2)
  await ui.press({ key: 'more' }) // closing reads nothing
  await clock.settle()
  expect(gitRuns()).toBe(closed + 2)
  await ui.unmount()
})

test('git failing to run never breaks the band', async ($, on) => {
  setup(on)
  engine.git = 'fail'
  await $.session.start(START)
  const ui = await mountBand($, 'desktop', 110)
  await ui.press({ key: 'more' })
  expect(await ui.drawn()).toBeDefined()
  await ui.unmount()
})

/** The strip's text once the cards are open. */
const stripText = async ($: Engine, clock: MockClock, open = true): Promise<string> => {
  const ui = await mountBand($, 'terminal', 140)
  if (open) await ui.press({ key: 'more' })
  await clock.settle()
  const strip = byKey(await ui.drawn(), 'strip', 'Box')
  await ui.unmount()
  return shown(strip)
}

/** git answering from now on with `branch` checked out. */
const checkedOut = (branch: string): void => {
  engine.git = { status: GIT_CLEAN.replace('branch.head main', `branch.head ${branch}`), dirs: GIT_MAIN_TREE }
}

test('a read asked for while one is out starts no git of its own: it follows, and the one out lands nothing', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  let release = (): void => undefined
  engine.hold = new Promise<void>(resolve => {
    release = resolve
  })
  const start = gitRuns()
  await turn($, 't1', 0, 0.1) // read A: main, held
  await clock.settle() // A reaches git and waits there
  expect(gitRuns() - start).toBe(2)
  checkedOut('feature')
  engine.hold = undefined
  await turn($, 't2', 0.2, 0.3) // read B, asked for while A is out
  await turn($, 't3', 0.4, 0.5) // and C
  await clock.settle()
  expect(gitRuns() - start).toBe(2) // still A's two processes alone
  release()
  await clock.settle()
  // A's answer, main, was stale by then; one more read, for B and C together, says feature.
  expect(gitRuns() - start).toBe(4)
  expect(await stripText($, clock)).toMatch(/on feature/)
})

test('a read that ends with none asked for since leaves no further read', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  const start = gitRuns()
  await turn($, 't1', 0, 0.1)
  await clock.settle()
  await turn($, 't2', 0.2, 0.3)
  await clock.settle()
  expect(gitRuns() - start).toBe(4) // two reads, each a pair
})

test('git output cut short is unknown, not a count: the last good reading stands', async ($, on) => {
  const clock = setup(on)
  engine.git = { status: `${GIT_CLEAN}1 .M N... 100644 100644 100644 a b a.ts\n1 .M N... 100644 100644 100644 a b b.ts\n1 .M N... 100644 100644 100644 a b c.ts\n`, dirs: GIT_MAIN_TREE }
  await $.session.start(START)
  await clock.settle()
  expect(await stripText($, clock)).toMatch(/3 changed/)
  // A status cut off after its first change would read as 1.
  engine.git = { status: `${GIT_CLEAN}1 .M N... 100644 100644 100644 a b a.ts\n`, dirs: GIT_MAIN_TREE }
  engine.truncates = 'git'
  await turn($, 't1', 0, 0.1)
  await clock.settle()
  expect(await stripText($, clock, false)).toMatch(/3 changed/)
  engine.truncates = undefined
  await turn($, 't2', 0.2, 0.3)
  await clock.settle()
  expect(await stripText($, clock, false)).toMatch(/1 changed/)
})

test('git output cut short on the first read leaves the path alone', async ($, on) => {
  const clock = setup(on)
  engine.truncates = 'git'
  await $.session.start(START)
  await clock.settle()
  expect(await stripText($, clock)).not.toMatch(/main/)
})

test('a read that fails keeps the last good git reading', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  engine.git = 'fail'
  await turn($, 't1', 0, 0.1)
  await clock.settle()
  expect(await stripText($, clock)).toMatch(/on main/)
})

test('two presses at once leave the cards as they were', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'desktop', 110)
  await Promise.all([ui.press({ key: 'more' }), ui.press({ key: 'more' })])
  expect(byKey(await ui.drawn(), 'cards', 'Box')).toBeUndefined()
  await ui.unmount()
})

test('/nextcost more reads git, like the toggle', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  const before = gitRuns()
  await runCommand($, 'more')
  await clock.settle()
  expect(gitRuns()).toBe(before + 2)
})

test('a new conversation reads git again, since a resume may be another project', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  const before = gitRuns()
  await $.session.end(CLEAR)
  await clock.settle()
  expect(gitRuns()).toBe(before + 2)
})

test('a resume reads git again too, and the other ways a session ends read nothing: git on the way out holds up the exit', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await clock.settle()
  for (const reason of ['prompt_input_exit', 'logout', 'other'] as const) {
    const before = gitRuns()
    await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
    await clock.settle()
    expect({ reason, runs: gitRuns() - before }).toEqual({ reason, runs: 0 })
  }
  const before = gitRuns()
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await clock.settle()
  expect(gitRuns()).toBe(before + 2)
})
