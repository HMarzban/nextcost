// The terminal's glyph tier. East-Asian-Ambiguous glyphs (█ ▓ ▒ ▌ │ · Σ … ±)
// draw two columns wide in a CJK locale, or with a terminal's "ambiguous is
// wide" option, while Ink counts one, so the row would overflow. The ascii
// tier maps them to ASCII; every mapping is one character at most, so the
// squeeze, measured before it, never undercounts. A wide character, such as a
// Japanese project's name, stays: every tier measures it two columns. Braille
// is Neutral width and stays in the unicode tier. Unicode
// EastAsianWidth-18.0.0, checked 2026-10-09.

import type { Icon } from './icons'
import { isWide } from './layout'
import type { BandSnapshot, Glyphs } from './snapshot'

const CJK = /^(ja|zh|ko)([_.-]|$)/i

/** The tier a session draws in: as asked by NEXTCOST_GLYPHS, else ascii in a
 *  CJK locale (the first of LC_ALL, LC_CTYPE and LANG that is set wins). */
export const resolveGlyphs = (env: Readonly<{ NEXTCOST_GLYPHS?: string; LC_ALL?: string; LC_CTYPE?: string; LANG?: string }>): Glyphs => {
  const asked = env.NEXTCOST_GLYPHS?.toLowerCase()
  if (asked === 'ascii' || asked === 'unicode') return asked
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || ''
  return CJK.test(locale) ? 'ascii' : 'unicode'
}

/** The tier the band draws in: the session's on a terminal, where
 *  ambiguous-width glyphs can draw wide; its own glyphs on every other surface. */
export const drawnTier = (snap: Pick<BandSnapshot, 'surface' | 'glyphs'>): Glyphs => (snap.surface === 'terminal' ? snap.glyphs : 'unicode')

/** Each glyph the band draws in this tier, and a name's punctuation it may
 *  meet in a path or a branch, in ASCII; an empty mapping drops the glyph. Any
 *  other non-ASCII character goes alone: see asciiText. */
export const ASCII_MAP: Readonly<Record<string, string>> = {
  '█': '#', '░': '-', '▒': ':', '│': '|', '·': '-', '…': '.', '±': '+',
  '●': '*', '■': '#', '–': '-', '↑': '+', '↓': '-', '▿': 'v', '▵': '^', '›': '>',
  // Neutral, but not ASCII: no view draws these here now; glyphs.test.ts holds them.
  '╌': '~', '╸': '>',
  '↻': '', 'Σ': '', '◷': '', '◔': '',
  // A hover card's caps: a space each keeps its width. ▐ is Neutral, but
  // goes with ▌ so a card's two ends match.
  '▐': ' ', '▌': ' ',
}

/** What an icon's glyph is said as in the ascii tier, where dropping it would
 *  leave a bare figure: `tok 225k`, `ctx 38%`, and after a
 *  limit's bar `| resets 3h 00m`, which a bare time beside a fill would not
 *  read as. A view draws the word itself rather than the glyph, so the squeeze
 *  measures the width it has. */
export const ASCII_WORDS: Readonly<Partial<Record<Icon, string>>> = { tokens: 'tok', context: 'ctx', reset: 'resets' }

/** `s` in ASCII and wide characters: a spaced separator a comma, since ` - `
 *  between numbers reads as a minus, and a screen reader says so; then each
 *  glyph mapped, a wide character kept, and any other non-ASCII character
 *  dropped alone. A glyph mapped to nothing takes the one space after it, so
 *  no gap is left where it was. */
export const asciiText = (s: string): string => {
  const chars = [...s.replace(/ · /g, ', ')]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    const mapped = ASCII_MAP[ch]
    if (mapped === '' && chars[i + 1] === ' ') i++
    out += mapped ?? (ch.charCodeAt(0) < 0x80 || isWide(ch) ? ch : '')
  }
  return out
}

/** The tree with every string, and every Button label, in ASCII. A node
 *  gains no field it didn't have. */
export const asciiTree = <T>(tree: T): T => {
  const walk = (k: unknown): unknown => {
    if (typeof k === 'string') return asciiText(k)
    if (Array.isArray(k)) return k.map(walk)
    if (k === null || typeof k !== 'object') return k
    const props = 'props' in k && typeof k.props === 'object' && k.props !== null ? k.props : undefined
    const label = props !== undefined && 'label' in props ? props.label : undefined
    return {
      ...k,
      ...(typeof label === 'string' ? { props: { ...props, label: asciiText(label) } } : {}),
      ...('children' in k && Array.isArray(k.children) ? { children: k.children.map(walk) } : {}),
    }
  }
  // The walk keeps every node's shape, which its type can't follow.
  return walk(tree) as T
}
