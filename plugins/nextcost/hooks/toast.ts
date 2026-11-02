// When the band speaks a toast, and what it says: the limits' and the
// context's, each once per threshold crossed. Pure: register.tsx speaks the
// texts and keeps the levels reached.

import { SEVERE_AT, WARN_AT, contextPressure, fmtPct, shownFrac, toCompaction } from './format'
import { FIVE_HOUR, SEVEN_DAY } from './snapshot'
import { roomOf } from './words'

/** Each toast's level reached, by its key, so it speaks once per crossing. */
export type Warned = ReadonlyMap<string, number>
/** The levels to remember, and the texts to speak, in order. */
export type Toasts = Readonly<{ warned: Warned; say: readonly string[] }>

/** No toast has spoken. */
export const NO_WARNINGS: Warned = new Map()

/** The context's keys, one per scale it is measured on: its levels toward
 *  the window and toward compaction are not one count. */
const CONTEXT = { window: 'context', compaction: 'context toward compaction' } as const

/** A toast re-arms once its figure falls back below this share. */
const TOAST_REARM_BELOW = 0.75

/** Whether a toast speaks, and the level to remember: it speaks once per
 *  threshold crossed (at the highest reached), holds while the figure stays
 *  up, and re-arms, back to level 0, once the figure falls under the re-arm
 *  share. `prev` is the level remembered from before. */
const escalate = (prev: number, frac: number, levels: readonly number[]): Readonly<{ level: number; speak: boolean }> => {
  const level = levels.filter(at => frac >= at).length
  if (level > prev) return { level, speak: true }
  return { level: frac < TOAST_REARM_BELOW ? 0 : prev, speak: false }
}

/** One toast's figure `frac` against its `levels`, under `key`: the level
 *  it reaches, and its text, given the figure as a percent, when it speaks. */
const note = (warned: Warned, key: string, frac: number, levels: readonly number[], text: (pct: string) => string): Toasts => {
  // At the figure shown: 79.6% is `80%`, amber, and speaks.
  const shown = shownFrac(frac)
  const { level, speak } = escalate(warned.get(key) ?? 0, shown, levels)
  return { warned: new Map(warned).set(key, level), say: speak ? [text(fmtPct(shown))] : [] }
}

/** What each window that speaks is called in its toast, by the kind the
 *  engine reports it under, which is also the key its level is kept by. */
const LIMIT_NAMES: ReadonlyMap<string, string> = new Map([
  [FIVE_HOUR, '5-hour limit'],
  [SEVEN_DAY, 'weekly limit'],
  ['spend_limit', 'spend limit'],
])

/** The limits' toasts, from the windows the engine reports: the 5-hour and
 *  weekly limits and a gateway's spend limit, each on its own count. */
export const limitToasts = (warned: Warned, limits: ReadonlyArray<Readonly<{ kind: string; percentUsed: number }>>): Toasts =>
  limits.reduce<Toasts>(
    (t, l) => {
      const name = LIMIT_NAMES.get(l.kind)
      if (name === undefined) return t
      const next = note(t.warned, l.kind, l.percentUsed / 100, [WARN_AT, SEVERE_AT], pct => `You've used ${pct} of your ${name}.`)
      return { warned: next.warned, say: [...t.say, ...next.say] }
    },
    { warned, say: [] },
  )

/** The context as a toast reads it: the tokens in use, undefined when the
 *  engine reports none, the window, where auto-compaction runs when it is
 *  on and known, whether it is off, and whether that is known yet: before
 *  it, the figure's scale isn't, and a toast on the window's would be
 *  followed by one on the compaction point's. */
export type ContextNow = Readonly<{ used: number | undefined; window: number; compactAt: number | undefined; autoCompactOff: boolean; scaleKnown: boolean }>

/** The context's toast. It speaks where the context pill turns amber: by the
 *  same rule. A level counts on the scale it was reached on, and each scale
 *  keeps its own: the one measured escalates and re-arms on its figure, and
 *  the other holds, so a compaction point the engine gives and drops by
 *  turns never speaks the same warning twice. */
export const contextToasts = (warned: Warned, c: ContextNow): Toasts => {
  const { used, compactAt } = c
  if (used === undefined || !c.scaleKnown) return { warned, say: [] }
  const { frac, levels } = contextPressure(used, c.window, compactAt)
  return note(warned, compactAt === undefined ? CONTEXT.window : CONTEXT.compaction, frac, levels, pct =>
    compactAt !== undefined ? (used >= compactAt ? 'Auto-compaction is due.' : `Auto-compaction in ${roomOf(toCompaction(used, compactAt))} tokens.`)
    : c.autoCompactOff ? `Context is ${pct} full and auto-compaction is off, so the conversation will run out of room.`
    : `Context is ${pct} full.`,
  )
}

/** The warnings once a conversation ends: the context's start over; the
 *  limits are the account's, and /clear changes nothing about them. */
export const forgetConversation = (warned: Warned): Warned => {
  const kept = new Map(warned)
  kept.delete(CONTEXT.window)
  kept.delete(CONTEXT.compaction)
  return kept
}
