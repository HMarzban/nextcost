// What each kind of token costs against base input, by model, as Anthropic
// lists it: the multipliers the band weighs a bill's tokens by, and the
// price tiers a long prompt pays. The base rate itself is no table's: the
// cache model solves it from the session's own bill.

/** How long a cache write lasts idle. */
export type Ttl = '5m' | '1h'

/** Tokens by kind, as a bill counts them; of those written, how many were
 *  written for an hour. */
export type TokenCounts = Readonly<{ uncached: number; written: number; writtenHour: number; read: number; output: number }>

export const NO_TOKENS: TokenCounts = { uncached: 0, written: 0, writtenHour: 0, read: 0, output: 0 }

export const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  uncached: a.uncached + b.uncached,
  written: a.written + b.written,
  writtenHour: a.writtenHour + b.writtenHour,
  read: a.read + b.read,
  output: a.output + b.output,
})

// The price of each kind of token against base input. Writes and output hold
// one ratio across Anthropic's models; reads do not. A cache write's ratio is
// its lifetime's, as Anthropic lists it and Claude Code's ledger bills it:
// 1.25× for five minutes, 2× for an hour (the ledger checked to the cent
// against a session's cost record, 2026-10-26).
export const WRITE_MULT: Readonly<Record<Ttl, number>> = { '5m': 1.25, '1h': 2 }
const OUTPUT_MULT = 5
/** A cache read against base input, by model; 0.1× elsewhere. Per Anthropic's
 *  list prices as of 2026-10: Opus 5.5 reads at $0.20 on $4.00 input, Sonnet
 *  5.5 at $0.10 on $2.00, Fable and Mythos 5.1 at $0.25 on $10.00. */
const READ_MULT_BY_MODEL: Readonly<Record<string, number>> = {
  'claude-opus-5-5': 0.05,
  'claude-sonnet-5-5': 0.05,
  'claude-fable-5-1': 0.025,
  'claude-mythos-5-1': 0.025,
}
const DEFAULT_READ_MULT = 0.1

/** The model a name bills as. `/model` names a 1M context window with a
 *  suffix, `claude-opus-5-5[1m]`, and the cost record names the model alone. */
export const modelName = (model: string): string => model.replace(/\[[^\]]*\]$/, '')

/** The model a provider's id for it names, for a price to be found by: past a
 *  window's suffix, an ARN's path or a Bedrock `us.anthropic.` prefix, a Bedrock
 *  `-v1:0` tail, and a date, Vertex's `@20261001` or the API's `-20261001`,
 *  eight digits exactly. Any other name stays as it is, and pays the default. */
export const baseModel = (model: string): string =>
  modelName(model)
    .replace(/^(?:.*\/)?(?:[a-z0-9-]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/[@-]\d{8}$/, '')

/** Prices that rise with a request's prompt, by model: past `over` input
 *  tokens, every price is `factor` times the lower tier's. Per Anthropic's
 *  list prices as of 2026-10: Haiku 5.5 is $0.10 input up to 100,000 prompt
 *  tokens and $0.50 over, the cache and output prices alike. */
const TIERS_BY_MODEL: Readonly<Record<string, Readonly<{ over: number; factor: number }>>> = {
  'claude-haiku-5-5': { over: 100_000, factor: 5 },
}

/** How many times the lower tier's prices a request with `prompt` input
 *  tokens pays on `model`: 1 on a model with one tier. */
export const tierFactor = (model: string | undefined, prompt: number): number => {
  const tier = model === undefined ? undefined : TIERS_BY_MODEL[baseModel(model)]
  return tier !== undefined && prompt > tier.over ? tier.factor : 1
}

/** What a cache read costs against base input on `model`. */
export const readMultiplier = (model: string | undefined): number =>
  (model === undefined ? undefined : READ_MULT_BY_MODEL[baseModel(model)]) ?? DEFAULT_READ_MULT

/** Tokens weighted by their price against base input on `model`: the one
 *  unknown left is the base rate itself. */
export const weightedTokens = (t: TokenCounts, model: string | undefined): number =>
  t.uncached +
  WRITE_MULT['5m'] * (t.written - t.writtenHour) +
  WRITE_MULT['1h'] * t.writtenHour +
  readMultiplier(model) * t.read +
  OUTPUT_MULT * t.output
