// Opening, closing and hiding the band: its toggle, its buttons and
// /nextcost's words; the site a survey holds; and the commands registered,
// and the settings read, before the band reads a transcript.

import { test, expect } from 'claude-code/testing'
import {
  BUILD_155K,
  PLUGIN,
  START,
  byKey,
  props,
  respond,
  runCommand,
  rowCount,
  cardOf,
  shown,
  walk,
  setup,
  mountBand,
  engine,
  fact,
  transcriptOf,
  HOME,
  HOUR,
} from './helpers'

test('the toggle opens the cards, and Hide hides the band', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)

  const ui = await mountBand($, 'terminal', 110)
  expect(rowCount(await ui.drawn())).toBe(1)

  await ui.press({ key: 'more' })
  expect(rowCount(await ui.drawn())).toBe(4) // the row, the workspace strip, the cards, the buttons

  await ui.press({ key: 'more' })
  expect(rowCount(await ui.drawn())).toBe(1)

  await ui.press({ key: 'more' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /\$2\.41/ })).toBeUndefined()
  await ui.unmount()
})

test('/nextcost more, less, hide and show drive the band', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)

  const ui = await mountBand($, 'terminal', 110)

  await runCommand($, 'more')
  expect(cardOf(await ui.drawn(), 'cache')).toBeDefined()
  await runCommand($, 'less')
  expect(cardOf(await ui.drawn(), 'cache')).toBeUndefined()
  await runCommand($, 'hide')
  expect(await ui.find({ type: 'Text', text: /\$2\.41/ })).toBeUndefined()
  await runCommand($, 'show')
  expect(await ui.find({ type: 'Text', text: /\$2\.41/ })).toBeDefined()
  await ui.unmount()
})

test('the band yields the site while a survey holds it', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...props(110), hasSurvey: true },
  })
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  await ui.unmount()
})

test('Collapse and Hide band are real buttons with c and h hotkeys, beside how to bring the band back', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'desktop', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  const collapse = byKey(tree, 'collapse', 'Button')
  const hide = byKey(tree, 'hide', 'Button')
  // Collapse, then Hide band, each its word alone, without a Ctrl-like glyph.
  const labels: string[] = []
  walk(tree, n => {
    if (n.type === 'Button' && (n.props?.key === 'collapse' || n.props?.key === 'hide')) labels.push(String(n.props?.label))
  })
  expect(labels).toEqual(['Collapse', 'Hide band'])
  expect(shown(tree)).toMatch(/Bring it back with \/nextcost/)
  expect(collapse?.props?.hotkey).toBe('c')
  expect(collapse?.props?.variant).toBe('secondary')
  expect(hide?.props?.hotkey).toBe('h')
  // Neither is the one to press: the calm band marks no main action, least
  // of all hiding itself.
  expect(hide?.props?.variant).toBe('secondary')

  await ui.press({ key: 'collapse' })
  expect(rowCount(await ui.drawn())).toBe(1)
  await ui.press({ key: 'more' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /\$2\.41/ })).toBeUndefined()
  await ui.unmount()
})

test('the commands are registered before the band reads a transcript to recall the last reply', async ($, on) => {
  setup(on, { env: HOME })
  // How many commands were registered when the recall's tail first read the transcript.
  let registeredAtRead: number | undefined
  Object.defineProperty(engine, 'transcript', {
    configurable: true,
    enumerable: true,
    get: () => {
      if (engine.runs.at(-1)?.argv[0] === 'tail') registeredAtRead ??= engine.commands.length
      return undefined
    },
    // The next test's reset makes it a plain field again.
    set: (value: string | undefined) => {
      Object.defineProperty(engine, 'transcript', { value, writable: true, configurable: true, enumerable: true })
    },
  })
  await $.session.start(START)
  expect(registeredAtRead).toBe(2)
  expect(engine.commands).toEqual(['nextcost', 'usage-band'])
})

test('the settings are read and applied before the band waits on a transcript to recall the last reply', async ($, on) => {
  const clock = setup(on, { env: { ...HOME, FORCE_PROMPT_CACHING_5M: '1' }, now: 3 * HOUR })
  engine.transcript = transcriptOf(0)
  let release = (): void => undefined
  engine.tailHold = new Promise<void>(resolve => {
    release = resolve
  })
  const started = $.session.start(START)
  await clock.settle()
  // The recall waits on its read of the transcript's end.
  expect(engine.runs.filter(({ argv }) => argv[0] === 'tail')).toHaveLength(1)
  const ui = await mountBand($, 'terminal', 140)
  await ui.press({ key: 'more' })
  // The TTL the environment pins is in force already.
  expect(fact(await ui.drawn(), 'expires')).toBe('5m idle')
  await ui.unmount()
  release()
  await started
})
