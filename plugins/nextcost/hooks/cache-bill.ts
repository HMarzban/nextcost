// What a session's prompt-cache model has been billed: each model's steps on
// their own book, the ledger as it was last read, and the base rate per token
// that solves to. Pure: cache.ts hands it what it reads of the ledger and of
// each response, and keeps the result as its `bill`.

import type { ModelUsage } from 'claude-code'
import { WRITE_MULT, baseModel, readMultiplier, tierFactor, weightedTokens } from './prices'
import type { TokenCounts, Ttl } from './prices'

/** A response, as turn.step has it. */
export type Response = Pick<ModelUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'> &
  Readonly<{ model?: string }>

/** Where a step stands on the rate's books. Told: the ledger told its bill.
 *  Untold: no read of the ledger told it, so it takes what the bill leaves over.
 *  Off the books: a server-side tool loop's bill holds a tool round the usage
 *  never shows, so neither its dollars nor its weight go in. */
type Standing = 'told' | 'untold' | 'offBook'

/** A model's main-loop writes since the lifetime was last read, at one lifetime
 *  they were weighed at: their tokens, and what they weigh with their price
 *  tier, as they stand on the book. A read that says otherwise moves them. */
type UnreadWrites = Readonly<{ tokens: number; told: number; untold: number }>

/** One model's own bill: what its told steps cost by the ledger and what they
 *  weigh, what its untold steps weigh, its reads at the lower tier's prices,
 *  what its reads weigh in the step's own read share, off the books or on, and
 *  its writes not yet read. */
type ModelBook = Readonly<{
  usd: number
  weight: number
  untold: number
  tieredReads: number
  ownReads: number
  unread: Readonly<Record<Ttl, UnreadWrites>>
}>

/** What a session has been billed. */
export type Bill = Readonly<{
  /** Each model's own bill, by its base name: the one ledger of what the
   *  steps weigh. Only with two can the session's bill not speak for one. */
  books: Readonly<Record<string, ModelBook>>
  /** The ledger when this conversation's first turn began, so spend from
   *  before it (a /clear, a resume, a reload) can't inflate the rate the
   *  re-warm price is solved from. */
  costBase: number
  /** That turn has begun: until then `costBase` is provisional. */
  baselined: boolean
  /** The ledger as the last step or turn start read it, from which a step's
   *  bill is told; undefined after a step it couldn't be read at, whose bill
   *  no later step should take. A redraw's read leaves it, so it never hides
   *  a step's. */
  ledgerSeen: number | undefined
  /** What steps with a server-side tool loop (the advisor) were billed: the
   *  tool's own round is billed but never in the usage, so the rate is solved
   *  without them. It also holds what the ledger grew by outside any step: a
   *  compaction's request raises no step, and has no tokens here. */
  offBookUsd: number
}>

export const NO_BILL: Bill = { books: {}, costBase: 0, baselined: false, ledgerSeen: undefined, offBookUsd: 0 }

/** What the rate needs of the model priced: its name, and every read so far,
 *  to weigh a whole bill at its share. */
export type Pricing = Readonly<{ model: string | undefined; reads: number }>

const NO_UNREAD_WRITES: ModelBook['unread'] = { '5m': { tokens: 0, told: 0, untold: 0 }, '1h': { tokens: 0, told: 0, untold: 0 } }

/** The bill of a conversation starting at `ledger`: its baseline is provisional
 *  until its first turn starts and takes the ledger then. */
export const billOfNewConversation = (ledger: number): Bill => ({ ...NO_BILL, costBase: ledger, ledgerSeen: ledger })

/** The engine may reset the ledger on /clear: once it reads below the
 *  baseline, it counts this conversation alone, so the baseline is 0. */
export const billAtRedraw = (b: Bill, ledger: number | undefined): Bill => (ledger !== undefined && ledger < b.costBase ? { ...b, costBase: 0 } : b)

/** The ledger as a turn starts: what it grew by since the last step is no
 *  step's, once the conversation has a baseline to grow from. The conversation's
 *  first turn takes it as its baseline. */
export const billAtTurnStart = (b: Bill, ledger: number | undefined): Bill => {
  if (ledger === undefined) return b
  const grown = b.baselined && b.ledgerSeen !== undefined && ledger > b.ledgerSeen ? ledger - b.ledgerSeen : 0
  return { ...b, offBookUsd: b.offBookUsd + grown, ledgerSeen: ledger, costBase: b.baselined ? b.costBase : ledger, baselined: true }
}

/** The ledger read as a step was sent and after its response: what the step
 *  was told, undefined with nothing to tell it by. What it grew by from the
 *  last step to the sending is no step's, kept off the rate's books. Another
 *  step that came back meanwhile read its own bill off the ledger, so a step's
 *  own counts from the later of the two reads. */
export const billAtStep = (was: Bill, sent: number | undefined, ledger: number | undefined): Readonly<{ bill: Bill; told: number | undefined }> => {
  const b = billAtRedraw(was, ledger)
  const seen = b.ledgerSeen
  if (ledger === undefined) return { bill: { ...b, ledgerSeen: undefined }, told: undefined }
  const grown = b.baselined && seen !== undefined && sent !== undefined && sent > seen ? sent - seen : 0
  const from = sent === undefined ? seen : Math.max(sent, seen ?? sent)
  return { bill: { ...b, offBookUsd: b.offBookUsd + grown, ledgerSeen: ledger }, told: from !== undefined && ledger > from ? ledger - from : undefined }
}

/** A response's tokens, what its price tier multiplies them by, and what they
 *  weigh. Its writes last `ttl`. Over `rounds` of a server-side tool loop, the
 *  usage sums every round's. */
export const weighResponse = (usage: Response, rounds: number, ttl: Ttl): Readonly<{ request: TokenCounts; factor: number; weighted: number }> => {
  const hit = usage.cache_read_input_tokens
  const written = usage.cache_creation_input_tokens
  const uncached = usage.input_tokens
  const request = { uncached, written, writtenHour: ttl === '1h' ? written : 0, read: hit, output: usage.output_tokens }
  // A request is priced by its whole prompt, cache reads and writes included:
  // each round's, where a tool loop sums them.
  const factor = tierFactor(usage.model, (uncached + hit + written) / rounds)
  return { request, factor, weighted: factor * weightedTokens(request, usage.model) }
}

/** Which book a step on `model` goes in. A key reads as the model it names. */
const bookKey = (model: string | undefined): string => (model === undefined ? '' : baseModel(model))

/** A response on its model's book, every response's, a subagent's included,
 *  since the session's bill includes every subagent and the rate is solved from
 *  it: its bill and weight by where it stands, its reads either way, and those
 *  `unread`, the main loop's, its writes at `ttl`. A step with a tool loop stays
 *  as weighed, on the books or off, whatever a read of the lifetime says. */
export const bookResponse = (
  b: Bill,
  step: ReturnType<typeof weighResponse> & Readonly<{ model: string | undefined; priced: string | undefined; standing: Standing; usd: number; ttl: Ttl; unread: boolean }>,
): Bill => {
  const { request, factor, weighted, standing, ttl } = step
  const offBookUsd = b.offBookUsd + (standing === 'offBook' ? step.usd : 0)
  if (weighted <= 0) return { ...b, offBookUsd }
  const key = bookKey(step.model ?? step.priced)
  const was = b.books[key] ?? { usd: 0, weight: 0, untold: 0, tieredReads: 0, ownReads: 0, unread: NO_UNREAD_WRITES }
  const tiered = factor * request.written
  const writes = was.unread[ttl]
  return {
    ...b,
    offBookUsd,
    books: {
      ...b.books,
      [key]: {
        ...was,
        usd: was.usd + (standing === 'told' ? step.usd : 0),
        weight: was.weight + (standing === 'told' ? weighted : 0),
        untold: was.untold + (standing === 'untold' ? weighted : 0),
        tieredReads: was.tieredReads + factor * request.read,
        ownReads: was.ownReads + readMultiplier(step.model) * request.read,
        unread: step.unread ? { ...was.unread, [ttl]: { tokens: writes.tokens + request.written, told: writes.told + (standing === 'told' ? tiered : 0), untold: writes.untold + (standing === 'untold' ? tiered : 0) } } : was.unread,
      },
    },
  }
}

/** The bill once the writes not yet read turn out to last `ttl`: those weighed
 *  at the other lifetime move to this one, so the rate is solved from what was
 *  really billed. And how many tokens that adds to the hour's, below zero
 *  where they leave it. */
export const writesReadAs = (b: Bill, ttl: Ttl): Readonly<{ bill: Bill; hourTokens: number }> => {
  const other = ttl === '1h' ? '5m' : '1h'
  const sign = ttl === '1h' ? 1 : -1
  const weight = sign * (WRITE_MULT['1h'] - WRITE_MULT['5m'])
  const books = Object.values(b.books)
  return {
    bill: {
      ...b,
      books: Object.fromEntries(
        Object.entries(b.books).map(([key, book]) => [
          key,
          { ...book, weight: book.weight + weight * book.unread[other].told, untold: book.untold + weight * book.unread[other].untold, unread: NO_UNREAD_WRITES },
        ]),
      ),
    },
    hourTokens: sign * books.reduce((sum, book) => sum + book.unread[other].tokens, 0),
  }
}

/** What the session has cost, to show: the ledger, or for a resumed
 *  conversation the larger of the ledger and its transcript's total, with
 *  the ledger's growth since the conversation's first turn on top. Never
 *  both summed: a host may restore the ledger on a resume, or may not, and
 *  may restore it only after the transcript is read, so the growth counts
 *  from the baseline that turn takes, never from the ledger at the read. */
export const spentUsd = (b: Bill, priorUsd: number | undefined, ledgerNow: number | undefined): number => {
  const ledger = ledgerNow ?? 0
  if (priorUsd === undefined) return ledger
  const growth = b.baselined ? ledger - b.costBase : 0
  return Math.max(ledger, priorUsd + growth)
}

/** What the steps have cost since the baseline: the ledger, as far as the last
 *  step read it, with what grew outside a step left out. Growth since that read
 *  is a request yet to report, or none of a step's. */
const billedInSteps = (b: Bill, sessionCost: number): number =>
  (b.baselined && b.ledgerSeen !== undefined ? Math.min(sessionCost, b.ledgerSeen) : sessionCost) - b.costBase - b.offBookUsd

/** The least one token weighs. Below it the whole bill's sum is rounding left
 *  where all its steps went off the books, not a weight to divide by. */
const LEAST_WEIGHT = 0.025

/** The rate the session's whole bill solves to, every token at the priced
 *  model's read share: one model's, when it is the only one. Each book's weight
 *  holds its reads at its own share, so those are taken back out for every read
 *  at the priced model's, off the books or on. */
const wholeBillRate = (b: Bill, priced: Pricing, sessionCost: number): number | null => {
  const weighted = Object.values(b.books).reduce((sum, book) => sum + book.weight + book.untold - book.ownReads, readMultiplier(priced.model) * priced.reads)
  const billed = billedInSteps(b, sessionCost)
  return weighted >= LEAST_WEIGHT && billed > 0 ? billed / weighted : null
}

/** The book of the model priced, if it has steps yet. */
const pricedBook = (b: Bill, priced: Pricing): ModelBook | undefined => b.books[bookKey(priced.model)]

/** Whether the session's whole bill speaks for the model priced: no other
 *  model has steps, or that model has none yet to go by (before a first reply,
 *  it may be named by an alias). */
const wholeBillSpeaks = (b: Bill, priced: Pricing): boolean => Object.keys(b.books).length <= 1 || pricedBook(b, priced) === undefined

/** The rate a book's own steps solve to; null with no bill told for them. */
const toldRate = (book: ModelBook | undefined): number | null =>
  book !== undefined && book.weight > 0 && book.usd > 0 ? book.usd / book.weight : null

/** The rate of the steps with no bill told: what the bill leaves over them. */
const leftOverRate = (b: Bill, sessionCost: number): number | null => {
  const books = Object.values(b.books)
  const untold = books.reduce((sum, book) => sum + book.untold, 0)
  const left = billedInSteps(b, sessionCost) - books.reduce((sum, book) => sum + book.usd, 0)
  return untold > 0 && left > 0 ? left / untold : null
}

/** The base rate per token, in dollars, on the model priced.
 *
 *  No pricing table is available to a mod, so the rate is solved from the
 *  session's own bill since its baseline, which leaves one unknown:
 *
 *    cost - costBase = r * (what the books weigh)
 *
 *  where each upper-tier request weighs its tier's factor over, so r is the
 *  lower tier's rate on a model with two, and a step with a server-side tool
 *  loop is left out of both sides, its tool's round billed with no tokens shown,
 *  as is what the ledger grew by outside a step.
 *
 *  The ledger doesn't say which model each dollar is for, but what it grows by
 *  across a step is that step's: with two models in the bill, each solves from
 *  its own steps. Where a step's read failed, its model takes what the bill
 *  leaves over.
 *
 *  It self-calibrates to whatever model and plan are in force, and it is an
 *  estimate on top of an estimate (the session cost is itself computed at list
 *  price), so what it prices is always shown with a "~". */
export const ratePerToken = (b: Bill, priced: Pricing, sessionCost: number | undefined): number | null => {
  if (sessionCost === undefined) return null
  if (wholeBillSpeaks(b, priced)) return wholeBillRate(b, priced, sessionCost)
  return toldRate(pricedBook(b, priced)) ?? leftOverRate(b, sessionCost)
}

/** The rate to remember under the model's name, for its other sessions: never
 *  a blend. */
export const rememberedRate = (b: Bill, priced: Pricing, sessionCost: number | undefined): number | null => {
  if (sessionCost === undefined) return null
  return wholeBillSpeaks(b, priced) ? wholeBillRate(b, priced, sessionCost) : toldRate(pricedBook(b, priced))
}

/** What reading from the cache saved against full input price, by the rate
 *  `rate` on the model priced: each model's reads at its own rate and read
 *  share where the bill has two. A resumed conversation's `priorReads` aren't
 *  split by model here, so they count at the rate in force. */
export const savedUsdOf = (b: Bill, priced: Pricing, sessionCost: number | undefined, rate: number | null, priorReads: number): number | null => {
  const share = readMultiplier(priced.model)
  const priorSaved = rate === null ? 0 : rate * (1 - share) * priorReads
  if (sessionCost === undefined || wholeBillSpeaks(b, priced)) return rate === null ? null : rate * (1 - share) * Object.values(b.books).reduce((sum, book) => sum + book.tieredReads, 0) + priorSaved
  const leftOver = leftOverRate(b, sessionCost)
  const books = Object.entries(b.books).map(([key, book]) => ({ rate: toldRate(book) ?? leftOver, saved: (1 - readMultiplier(key)) * book.tieredReads }))
  if (rate === null && books.every(book => book.rate === null)) return null
  return books.reduce((sum, book) => sum + (book.rate ?? 0) * book.saved, priorSaved)
}
