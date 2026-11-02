// What the session's environment and settings say of its cache: the TTL
// they pin, if any, and where Claude Code compacts the conversation when it
// sits idle. Pure: register.tsx reads each variable and setting by name and
// hands them here.

import type { Ttl } from './prices'

const IDLE_COMPACT_TOKENS = 200_000
const IDLE_COMPACT_FLOOR = 100_000

const truthy = (v: string | undefined): boolean => v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

/** The context, in tokens, from which Claude Code compacts this session when
 *  it sits idle; undefined when it never does: `idleCompaction: false`, or
 *  compaction turned off. The threshold takes a positive whole number, raised
 *  to 100k, as Claude Code does. Where it runs is the surface's to say, as the
 *  band draws it. */
export const idleCompactFrom = (o: {
  setting: unknown
  disableAuto: string | undefined
  disableAll: string | undefined
  minTokens: string | undefined
}): number | undefined => {
  if (o.setting === false || truthy(o.disableAuto) || truthy(o.disableAll)) return undefined
  const min = o.minTokens !== undefined && /^\d+$/.test(o.minTokens.trim()) ? Number(o.minTokens.trim()) : 0
  return min > 0 ? Math.max(IDLE_COMPACT_FLOOR, min) : IDLE_COMPACT_TOKENS
}

const asTtl = (v: unknown): Ttl | undefined => (v === '5m' || v === '1h' ? v : undefined)

/** The TTL the environment or the settings pin, if they pin one, in Claude
 *  Code's order: forcing 5m, the main conversation's variable, then its
 *  `promptCacheTtl` setting, then asking for 1h. Any other value is ignored,
 *  as Claude Code ignores it. */
export const resolveTtl = (env: {
  force5m: string | undefined
  chosen: string | undefined
  setting: unknown
  enable1h: string | undefined
}): Ttl | undefined => {
  if (env.force5m === '1') return '5m'
  const chosen = asTtl(env.chosen) ?? asTtl(env.setting)
  if (chosen !== undefined) return chosen
  if (env.enable1h === '1') return '1h'
  return undefined
}
