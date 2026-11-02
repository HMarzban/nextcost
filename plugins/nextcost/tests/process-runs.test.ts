// Every program the band runs is asked for in a fixed place and for a fixed
// time: git in the project, the transcript's readers where the engine is,
// each given 3 seconds, as SECURITY.md says. Without a timeout the engine
// waits 30 seconds on a hung program.

import { test, expect } from 'claude-code/testing'
import { LONG, PROJECT, START, TURN_DONE, BUILD_80K, engine, respond, setup, transcriptOf } from './helpers'

const ENV = { HOME: '/Users/me' }

test('every program the band runs is given its place and 3 seconds', LONG, async ($, on) => {
  const clock = setup(on, { env: ENV, now: 10_000_000 })
  engine.transcript = transcriptOf(clock.now() - 60_000)
  await $.session.start(START)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.advance(600)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '', seconds_since_last_response: 60 })
  await clock.settle()

  const shapes = new Set(engine.runs.map(run => run.argv.slice(0, 2).join(' ')))
  // Each of the five commands ran, so no check below passes by having nothing to check.
  expect([...shapes].sort()).toEqual(['git -c', 'git rev-parse', 'grep -a', 'tail -c'])
  expect(engine.runs.map(run => run.argv.join(' ')).filter(argv => argv.startsWith('tail -c +'))).not.toHaveLength(0)
  expect(engine.runs.map(run => run.argv.join(' ')).filter(argv => argv.startsWith('tail -c 1048576'))).not.toHaveLength(0)

  for (const { argv, cwd, timeoutMs } of engine.runs) {
    expect({ argv, timeoutMs }).toEqual({ argv, timeoutMs: 3000 })
    // git reads the project; the others name their file in full and take the engine's own place.
    expect({ argv, cwd }).toEqual({ argv, cwd: argv[0] === 'git' ? PROJECT : undefined })
  }
})
