// The band's palettes, dark, light and plain, and the colours for what sits
// on its bare ground.

/** A filled pill needs its foreground and background from one source: a
 *  theme key resolves against the user's theme, a hex does not, and mixing
 *  them makes a pill that is legible on one theme and blank on the other.
 *  Nothing in the API reports whether the theme is light or dark, so the
 *  palette is declared rather than guessed: NEXTCOST_APPEARANCE = dark |
 *  light | plain. */
export type Palette = {
  filled: boolean
  surface: string
  value: string
  label: string
  /** A warm cache: the battery's charge, and the dot in plain appearance. */
  warm: string
  /** A cold cache's dot in plain appearance. */
  cold: string
  amberBg: string
  amberFg: string
  /** The desktop's ground inside a meter's, a track's and a guessed day's
   *  edge, which trackStroke draws. */
  meterTrack: string
  /** A text track's empty cells (░ ⣀) and an unmeasured day's edge: 3:1
   *  against every ground they sit on. */
  trackInk: string
  meterFill: string
  /** The expanded view's cards: fill, edge, and their values. */
  cardBg: string
  cardBorder: string
  cardValue: string
  /** A hover card's ground and ink, inverted against the palette (light in
   *  dark, dark in light), so a card over the row can't pass for one more
   *  chip: no chip uses that ground. */
  tooltipBg: string
  tooltipFg: string
  /** A bar track's edge, so the track reads against any ground. */
  trackStroke: string
  /** The cache battery's charge, calm and in its last minute. */
  batteryFill: string
  batteryAmber: string
  /** The cost pill's coin. */
  coin: string
  /** The 5-hour and 7-day chips' tints: background, text, and bar and icons. */
  fiveBg: string
  fiveFg: string
  fiveAccent: string
  weekBg: string
  weekFg: string
  weekAccent: string
  /** The departures board: the case behind the tiles, dark in dark and
   *  light alike (plain draws none). */
  boardBg: string
  /** A flap tile's face. */
  flapBg: string
  /** The hairline across a tile's middle: decoration, no contrast target. */
  flapSeam: string
  /** Each item's ink on a tile; the 5h and 7d ones are the chips' accents. */
  flapItemCache: string
  flapItemSpend: string
  flapItemContext: string
  flapItem5h: string
  flapItem7d: string
  /** The board's plain text, its dim words and its warning amber. */
  flapText: string
  flapDim: string
  flapAmber: string
}

/** Dark's 5-hour and 7-day accents, which the board's tiles wear too. */
const DARK_FIVE = '#7fcf8a'
const DARK_WEEK = '#a99cf0'

/** The departures board, dark in dark and light alike: its case, its tiles
 *  and their inks, the 5h and 7d ones dark's accents. */
const BOARD = {
  boardBg: '#141414',
  flapBg: '#262626',
  flapSeam: '#0E0E0E',
  flapItemCache: '#7FD48A',
  flapItemSpend: '#E8C25A',
  flapItemContext: '#9DB4D0',
  flapItem5h: DARK_FIVE,
  flapItem7d: DARK_WEEK,
  flapText: '#F2EEE3',
  flapDim: '#B9B4A8',
  flapAmber: '#F5B14C',
}

export const DARK: Readonly<Palette> = {
  filled: true,
  surface: '#2b2b33',
  value: '#ececf2',
  label: '#9a9aa4',
  warm: '#7fcf8a',
  cold: '#6f6f7a',
  amberBg: '#3a2f17',
  amberFg: '#f0c969',
  meterTrack: '#45454f',
  trackInk: '#787889',
  meterFill: '#b8b8c2',
  cardBg: '#2a2a31',
  cardBorder: '#76767f',
  cardValue: '#c4c4cc',
  tooltipBg: '#dcdce4',
  tooltipFg: '#1d1d22',
  trackStroke: '#7c7c86',
  batteryFill: '#24402b',
  batteryAmber: '#5a4719',
  coin: '#c9a54a',
  fiveBg: '#1e3324',
  fiveFg: '#cfe8d3',
  fiveAccent: DARK_FIVE,
  weekBg: '#2a2540',
  weekFg: '#d9d3f5',
  weekAccent: DARK_WEEK,
  ...BOARD,
}

export const LIGHT: Readonly<Palette> = {
  filled: true,
  surface: '#ededf2',
  value: '#1d1d22',
  label: '#63636e',
  warm: '#2f8a45',
  cold: '#a0a0aa',
  amberBg: '#fbeccd',
  amberFg: '#7a4e06',
  meterTrack: '#d6d6de',
  trackInk: '#82829b',
  meterFill: '#55555f',
  cardBg: '#f4f4f7',
  cardBorder: '#77777f',
  cardValue: '#3a3a42',
  tooltipBg: '#2b2b33',
  tooltipFg: '#ececf2',
  trackStroke: '#77777f',
  batteryFill: '#cfe8d3',
  batteryAmber: '#f3d9a0',
  coin: '#9a7414',
  fiveBg: '#dff0e0',
  fiveFg: '#1f5c2e',
  fiveAccent: '#2f8a45',
  weekBg: '#e8e4fa',
  weekFg: '#3c3489',
  weekAccent: '#6b5fd3',
  ...BOARD,
}

// No backgrounds at all: every colour is a theme key, so it follows whatever
// theme the user has. The safe fallback, and what NO_COLOR terminals want.
export const PLAIN: Readonly<Palette> = {
  filled: false,
  surface: '',
  value: 'text',
  label: 'subtle',
  warm: 'success',
  cold: 'subtle',
  amberBg: '',
  amberFg: 'warning',
  meterTrack: 'subtle',
  trackInk: 'subtle',
  meterFill: 'text',
  cardBg: '',
  cardBorder: 'subtle',
  cardValue: 'text',
  tooltipBg: '',
  tooltipFg: 'text',
  trackStroke: 'subtle',
  batteryFill: '',
  batteryAmber: '',
  coin: 'warning',
  fiveBg: '',
  fiveFg: 'text',
  fiveAccent: 'success',
  weekBg: '',
  weekFg: 'text',
  weekAccent: 'text',
  boardBg: '',
  flapBg: '',
  flapSeam: '',
  flapItemCache: 'text',
  flapItemSpend: 'text',
  flapItemContext: 'text',
  flapItem5h: 'text',
  flapItem7d: 'text',
  flapText: 'text',
  flapDim: 'text',
  flapAmber: 'text',
}

/** The palette NEXTCOST_APPEARANCE names; NO_COLOR forces plain. */
export const resolvePalette = (appearance: string | undefined, noColor: string | undefined): Readonly<Palette> =>
  noColor ? PLAIN : appearance === 'light' ? LIGHT : appearance === 'plain' ? PLAIN : DARK

/** Colours for what sits on the band's bare ground, which is the host's and
 *  may be dark or light whatever the palette says. Text there takes theme
 *  keys, its label `inactive`, about 5.8:1 on Claude Code's grounds, where
 *  `subtle` is 2.07:1 in terminal dark; an icon needs hex, so these hold
 *  3:1 on dark and light grounds alike. The branch icon is the band's one
 *  blue: it means git, never a status. */
export const BARE = {
  value: 'text',
  label: 'inactive',
  icon: '#80808a',
  branch: '#5c85d6',
} as const
