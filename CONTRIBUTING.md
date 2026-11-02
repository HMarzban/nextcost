# Contributing

Thanks for helping. This file covers the development loop, the rules the
code follows, and what a pull request needs.

## Development loop

You need Claude Code with mods (function-hooks plugins). Tests and checks
run locally; nothing here needs network access or an API key.

```bash
# Check the marketplace index and the plugin
claude plugin validate .
claude plugin validate plugins/nextcost

# Run the tests
claude plugin test plugins/nextcost

# Run only some test files, by name glob (the red and green steps)
tools/test-only.sh view-pulse 'golden-*'

# Type-check (after the engine has laid the types, see below)
npx -y -p typescript@5 tsc -p plugins/nextcost
npx -y -p typescript@5 tsc -p tools/demos

# The views gate: no view formats or reads a raw fact
tools/views-gate.sh

# Lint the tools' shell scripts and Python, as CI does
git ls-files -z 'tools/*.sh' | xargs -0 shellcheck -x
pipx run ruff==0.17.1 check tools
```

The type check reads the engine's API types from
`plugins/nextcost/.claude-plugin/types/`. The engine writes them
the first time it loads the plugin from its folder, for example with
`claude --plugin-dir plugins/nextcost`. They're generated, so
they're git-ignored. Neither `claude plugin test` nor `validate` writes
them, and loading needs a signed-in session, so CI can't type-check: run it
locally before you open a pull request.

The second check covers the demo captures in `tools/demos/capture/`, with
`tools/demos/tsconfig.json`, which extends the plugin's. They run from a
scratch copy's `tests/`, so its `rootDirs` reads `tools/demos/` as the
plugin's folder and `capture/` as its `tests/`, and their `./helpers` and
`../hooks/…` imports resolve as they do there. The plugin's own config names
nothing outside its folder, which ships as it is.

CI runs the plugin's checks twice: on the latest Claude Code, and on a pinned
version last known good (`matrix.claude-code` in `.github/workflows/ci.yml`),
and lints the tools once.
It also runs nightly, so a new release that breaks the band shows within a
day. Red on latest alone means a Claude Code release changed something:
fix the band or its tests for it, then bump the pin to that release, in
`ci.yml`, in both READMEs' Install sections and in the site's FAQ
(`tools/demos/site/template.html`), which name the pinned version. Red on both means the change itself.

To see a change live, add your clone as the marketplace and install from
it. From the clone's parent folder:

```bash
claude plugin marketplace add ./nextcost
claude plugin install nextcost@hossein-mods
```

Then, after each edit, bump `version` in
`plugins/nextcost/.claude-plugin/plugin.json`; an update at the
same version doesn't reinstall. Any higher number works locally; set the
real one ([step 1](#before-you-open-a-pull-request)) before you open the
pull request. After each bump, run:

```bash
claude plugin marketplace update hossein-mods
claude plugin update nextcost@hossein-mods
```

A new version loads only when Claude Code starts again: on the desktop,
quit the app with Cmd+Q and open it again; in the terminal, exit and start
`claude` again. `/reload-plugins` doesn't load a new version.

## How the code is laid out

| File | Role |
| --- | --- |
| `hooks/hooks.json` | Names `register.tsx` as the plugin's one module. The engine loads it, and it imports the rest. |
| `hooks/register.tsx` | The hooks, and the only module that touches the engine (`$`): it reads what the engine knows into the pure modules and carries out what they decide. It declares the atoms, starts each session's band from `freshSession`, and names session.start's jobs: `startTicker`, `registerCommands`, `readAppearance`, `readCacheSettings` and `recallOnLoad`. Exports `register`. |
| `hooks/command.ts` | What `/nextcost` answers and changes, and how it reads its arguments (`parseCommand`). Pure: `commandPlan` makes a plan (the reply, the layout to save, the atoms' new values, whether to read the workspace), and `register.tsx` carries it out. The one list of words it takes builds both `ARGUMENT_HINT`, the menu's hint, and the usage reply in `REPLY`; `LAYOUT_PURPOSE` says what each layout is for, in `/nextcost layout`'s list. |
| `hooks/toast.ts` | When the band speaks a toast, and what it says: `limitToasts` for the 5-hour limit and `contextToasts` for the context, once per threshold crossed, each scale keeping its own level (`Warned`); `forgetConversation`, the levels a new conversation starts over. Pure: `register.tsx` speaks the texts and keeps the levels. |
| `hooks/snapshot.ts` | The snapshot (`BandSnapshot`) and actions (`BandActions`): the one contract between `register.tsx` and the drawing, and `snapshotOf`, the one pure builder of it, which the tests build by too. With it, the layouts' names (`LAYOUT_NAMES`, `DEFAULT_LAYOUT`, `asLayoutName`), the removed ones a stored layout or the command may still name (`removedLayoutOf`, `REMOVED_IN`), the limits as the engine reports them (`limitOf`, `splitLimits`, `LimitUse`), and `resetsOf`, the resets the timer repaints by. |
| `hooks/band.tsx` | `drawBand(elements, snapshot, actions)`: a pure function from a snapshot to a tree. It builds the kit and the readings and draws the layout `layoutAt` picks (chips below 40 columns, or below the layout's own `minColumns`), all inside one fallback: whatever throws, chips is drawn in its place, and where chips throws too, the hook steps aside. The ascii tier maps the tree last. |
| `hooks/kit.tsx` | `makeKit`, the drawing kit made once per draw: the elements, `Svg` (undefined but on the desktop in a filled palette), the palette and measure, `oneLine` for a line that may be cut, the hover cards (`liftedCard` on the desktop, `hoverable` and `hoverCard` on a text surface), `gap` and `air`, `icon`, `mark`, the text that stands for an icon (its glyph, or in the ascii tier its word), and `svg`, which builds every Svg. |
| `hooks/facts.ts` | The facts each reading holds (`Tone`, and the context's, spend's and limits' facts) and `Frame`, what every layout draws by. Types alone, over `format.ts`'s, so any module imports them without a cycle. |
| `hooks/reading.ts` | `readingsOf`: everything a view reads, built once per draw. Each section's facts beside its words from `words.ts` (a window's is a `LimitReading`), and chips' own from `chips-words.ts`; the history, the week and the board's rows (`board-words.ts`) are built the first time a view calls for them. |
| `hooks/words.ts` | The phrasebook: every phrase a layout draws, built from the facts (`cacheWords`, `spendWords`, `contextWords`, `limitWords`, `historyWords`, `weekWords`), so amber, pace, resets, empty states and alt text read the same everywhere; and the primitives the board's and chips' words are built with. |
| `hooks/chips-words.ts` | `chipsWords`, chips' own words: the cache pill's table by mood, its hover cards, the limits' titles and the context's amount. Built with the phrasebook's primitives, and frozen with chips' trees, so it keeps its own table. |
| `hooks/board-words.ts` | `boardWords`, the departures board's words: a row per reading in the board's capitals, its statuses, short forms, remarks and alt sentences; and its headings and header (`BOARD_HEADINGS`, `BOARD_TITLE`, `BOARD_NOW`). Built with the phrasebook's primitives, so the board says what every layout says. |
| `hooks/views/view.ts` | `View`: the rows a layout declares on each surface, its `minColumns` where it needs more than 40, its `collapsed` row and what it `open`s; and `rowsOf`, the rows it takes where it is drawn. |
| `hooks/views/index.ts` | `VIEWS`: every layout by name, written as the views gate reads it. |
| `hooks/views/frame.tsx` | What every layout's frame shares: `drawView` (a view's collapsed row with `toggleButton` at its end, and while open what opens beneath it), `bodyRowsFor`, `rowRoom`, `topStrip`, the `footer` (the workspace strip in `footerStripRoom`, the room the buttons leave, else the hint; then Collapse and Hide band), and the one give-way engine: `fitLine` squeezes a collapsed row by its view's order (`PieceOf`), telling its build what it `Keeps`. `line` lays pulse's and departures' pieces, and `groundOf` and `pieceGap` give a piece its ground and gap at each step. |
| `hooks/views/shell.tsx` | The card family chips' and pulse's open views share: which cards there are and their marks, a limit's accent (`limitAccent`), a card's ground and edge, its title and headline, its fact rows, a line of cards' geometry (`cardLine`: how many a line holds, the room inside each and its edge), their grid, and the alert drawn where none fits. |
| `hooks/views/chips.tsx` | `chipsView`: chips' row of pills, the cache's led by the battery from `charts.tsx`, squeezed by `fitLine`. Exports its pill builders (`cachePill`, `limitPill`, `chipsPills`), its row (`pillRow`) and `CHIP_BAR` for its tests. |
| `hooks/views/chips-open.tsx` | `chipsOpen`, chips' open view: its four cards on the shell, the workspace strip on top (`topStrip`) while every card still keeps a fact, else in the footer, then the footer. |
| `hooks/views/pulse.tsx` | `pulseView`: pulse's collapsed row, a tile per reading, its name, its figure, then its chart. |
| `hooks/views/pulse-open.tsx` | `pulseOpen`: four cards on the shell, each with its chart, their give-way, then the footer with the strip. |
| `hooks/views/pulse-charts.tsx` | Pulse's charts, each built in one place at the size its caller gives: `beatsChart`, `windowTrail` and `weekCells`; and `chartsDraw`, whether they draw at all (the ascii tier draws the words). |
| `hooks/views/departures.tsx` | `departuresView`: departures' collapsed row, each reading its own module of flap tiles. Its `minColumns` is 60. |
| `hooks/views/departures-board.tsx` | `departuresOpen`, departures' open board: its ground, its header (`DEPARTURES` and the time now), the quiet headings, a line per reading in aligned columns and their give-way; then frame's footer, which it places. `ITEM_INK`, each reading's ITEM ink, which the collapsed row shares. |
| `hooks/flaps.tsx` | The split-flap tiles departures draws (`flaps`): one Svg per reading on the desktop, a coloured run of text in the terminal; the open board's flap columns (`flapColumns`), its rules (`boardRule`) and the height its lines take (`boardLineHeight`, `boardBudget`). |
| `hooks/strip.tsx` | `drawStrip`, the workspace strip at the first squeeze that fits its room, on top or in the footer: project, branch or worktree, changes, ahead/behind. |
| `hooks/charts.tsx` | The charts: `meter`, `splitBar`, `sparkline`, `barChart`, `dayCells` (`dayCellsFit` says whether they fit), `heartbeat`, `flatBeats`, `track`, and chips' cache battery (`batteryIcon`, `textBattery`), each an Svg on the desktop, built by `kit.svg`, and text elsewhere; and `braille`, the terminal's chart as a string. |
| `hooks/glyphs.ts` | The terminal's glyph tier (`resolveGlyphs`, from `NEXTCOST_GLYPHS` or a CJK locale; `drawnTier`) and the ASCII mapping (`asciiText`, `asciiTree`), with `ASCII_WORDS`, the words the icons it would drop are said as (`tok`, `ctx`, `resets`). The ascii tier keeps a wide character, such as a Japanese name's, and every tier measures it two columns. |
| `hooks/calendar.ts` | The day and hour cells pulse draws, read off the limit samples (`weekOf`), and the week's cells as drawn, each guess stopped at the cap (`drawnWeekOf`). |
| `hooks/layout.ts` | How the band measures a line: the one width rule (`textCells`: a wide character takes two columns), the clips that cut a line to its columns (`clipMiddle`, `clipWords`, `clipToTiles`), how many columns a drawn tree takes on each surface (`cellsOf`, `TERMINAL`, `DESKTOP`), the sizes it lays out by (`ROW_SLACK`, `CARD_TEXT`), and `squeezeToFit`, which `fitLine` and the strip run. Each view names its own give-way order. |
| `hooks/icons.ts` | The icons' SVG bodies (`ICON_PATHS`), glyphs (`GLYPH`) and names (`ALT`). |
| `hooks/cache.ts` | The prompt-cache model, one per session (`newCache`), fed each hook's facts in that hook's own shape: TTL (and the lifetime the transcript says a write was made for, `wroteFor`), misses, recall, a resume, and the cache's view for the band. What the view means and what it bills are the next two rows'. |
| `hooks/cache-facts.ts` | What the cache's view means: its moods and the facts a layout draws by (`cacheFactsOf`): its charge, its last call, whether idle compaction is near, whether it is `untimed`. Types and one pure function, so any module imports them without a cycle. |
| `hooks/cache-bill.ts` | The cache model's bill: the per-model ledger (`books`), each model's rate solved from its own steps (`ratePerToken`) and what that prices: the re-warm and what the cache saved. |
| `hooks/prices.ts` | What each kind of token costs against base input, as Anthropic lists it: `WRITE_MULT`, `readMultiplier` by model, `tierFactor` for the price tiers a long prompt pays, `weightedTokens`, and `modelName`, the model a name bills as; with `TokenCounts`. |
| `hooks/cache-settings.ts` | What the environment and settings say of the cache: `resolveTtl`, the lifetime they pin, if any, and `idleCompactFrom`, where idle compaction runs. Pure: `register.tsx` reads each variable and setting by name. |
| `hooks/insights.ts` | `newInsights`, one set per session, made beside the cache model: the trails pulse draws, each message's cost and the context; the last message's cost, the cost trail's newest entry (`lastCostOf`); and the 5-hour pace. |
| `hooks/format.ts` | Numbers, times and escalation marks, as the band words them: `grainOf`, the one rule for how finely a countdown is said; `parseReset`, the one place a reset is parsed, and `sameReset`; `fmtPercent` and `fmtPct`; the zone a clock time is read in; and `paintKey`, every phrase the clock alone moves, as one key. |
| `hooks/palette.ts` | The dark, light and plain palettes (`resolvePalette`), among them `trackInk` for a text track's empty cells, and `BARE`, the colours for the band's bare ground. |
| `hooks/workspace.ts` | The workspace strip's git state, parsed from git's output (`parseGitState`), and its path (`homeRelative`, `splitPath`). |
| `hooks/memory.ts` | What the band keeps in its own store across sessions: each session's record of its last reply's time and the model it was billed under (`rememberReply`), the rate solved for each model, kept under the billed model's name (`rememberRate`), the layout, and the limit samples; and how a recall weighs the store against a transcript (`fromStore`, `needsTranscript`, `recallOf`): the store first. |
| `hooks/transcript.ts` | What the band reads off a session's transcript: where it is (`transcriptPath`), its last main-loop reply and the model it was billed under, the rate its cost record solves to, how long its cache was last written for, and what the session had spent. Every line is untrusted data, parsed on its own. |
| `types/index.d.ts` | The plugin's state contract: the two atoms. |
| `tests/` | Tests, one file per behaviour, named for it; the files below are shared. |
| `tests/globals.d.ts` | Declares `console`, which the tests have at run time and the type check's es2023 lib lacks. `test-only.sh` and the demo build copy it with the shared files. |
| `tests/helpers.ts` | The engine's fake and what most tests start from: `setup()` starts a test from a fresh engine, `mountBand()` draws the band, `runCommand()` types a command, `byKey()` finds a node, `wordsOf()` reads a tree's words; the named responses (`resp`, `respond`, `BUILD_155K`, `BUILD_100K`, `READ_100K`, `BUILD_80K`), `ledgerGrows`, which moves the ledger with no step to show for it, `TURN_START`, `TURN_DONE` and `SPEND_LIMIT`; the `LONG` budget; and the transcript fixtures (`jsonl`, `replyLine`, `requestLines`, `costRecord`, `transcriptOf`). |
| `tests/cases.ts` | The states every layout is drawn in (`SCENARIOS`) and `drawCases`, which draws them: one setup and one drive, then each mount shut and open; and golden's scenarios, appearances and mounts. |
| `tests/matrix.ts` | All of `cases.ts`, and for a pure test, `SNAP_PARTS` and `snapOf`, which builds its snapshot through `snapshotOf`, `kitOf` and `bandOf`, which make the kit and draw the band from it with `NO_ACT`, and the snapshot fixtures the tests share (`NO_HISTORY`, `HISTORY`, `CALM_LIMITS`, `COLD_CACHE` and the rest); the invariant checks and `ASCII_TIER`; and `viewSuite`, which each layout's `view-<name>` test file runs (chips' trees are golden's). |
| `tests/cover.ts` | `partCovered`, the whole-pieces check: in a text surface's frame a hover card shows in, every piece of its row is covered whole or left whole. The desktop's cards open above their piece and cover none. |
| `tests/golden/chips.ts` | Chips' frozen trees: `GOLDEN`, a hash per case, and `GOLDEN_TREES`, ten of them whole; see the rule below. |
| `tests/golden/hash.ts` | `treeHash`, a tree's fingerprint: its `canon`ical form, every clock time read alike and the engine's own marks dropped, hashed by `fnv1a`, and that form's length. |
| `tests/golden/suite.ts` | `goldenSuite(0 \| 1)`: the tests that hold chips to its frozen trees, for one half of `GOLDEN_SCENARIOS`. |
| `tools/test-only.sh` | Runs only the tests whose names match the globs given, against a scratch copy of the plugin. |
| `tools/scratch.sh` | `scratch_plugin`, which `test-only.sh` and the demo build source: a scratch copy of the plugin without its tests. |
| `tools/views-gate.sh` | The views gate, run in CI: the rules under *A new layout* below. |
| `tools/demos/build.sh` | Rebuilds every demo and the site from the band's own output; see `tools/demos/README.md`. |

## Rules the code follows

- **`$` stays in `register.tsx`.** The engine refuses it anywhere else.
  Everything the band shows reaches `band.tsx` through the snapshot. Each
  call is spelled out at its site with literal names, `$.env.get('LANG')`,
  never through a helper that loops over names: the engine reads the calls
  to list what a module touches, and refuses to load one it can't.
- **Never name a local variable `h`.** JSX compiles to the global `h()`.
- **No whitespace-only string children on the desktop.** It drops them, so
  a gap there is a spacer `Box`. Text surfaces keep their spaces.
- **Svg is desktop-only.** Other surfaces hold the element but draw
  nothing, so the kit's `svg` builds every Svg, and its element, `kit.Svg`,
  is undefined elsewhere and in the plain palette.
- **No SVG names an id.** Svgs can share a page, where a repeated id
  resolves to the first, so a drawing rounds its own ends rather than clip.
- **A hover card has no key.** A keyed Box is its own hover scope, and a
  hidden one could never be hovered.
- **The cache's lifetime is read, not guessed, where it can be.** Claude Code
  doesn't hand a mod a reply's cache-write split, so after a turn that wrote
  to the cache (`writeUnreadSince` in `cache.ts`), `readLifetime` reads it off
  the transcript's end, up to three looks while Claude Code logs the turn's
  line; the inference from a short read is what's left when that read fails.
  What it reads, and when, is in [SECURITY.md](SECURITY.md).
- **On the desktop a hover card sits inside the keyed Box it explains.** The
  kit's `liftedCard`, a hidden placed Box with a hover and no scope, is what
  the desktop raises to a popover above that Box. It names no size, place,
  ground or ink: the desktop drops them and gives it its own card's.
- **On a text surface a hover card is drawn after the pieces of its row.** A placed Box paints
  over those before it, so a card inside its piece would sit under the
  pieces after. The kit's `hoverable` and `hoverCard` join the two by a hover
  scope. The pointer on a showing card keeps it showing, so a card sits at
  its piece and covers whole pieces: its text, then the rest of any piece it
  enters, never part of one. A control the card may reach, like the band's
  ▵, comes after it.
- **A line that may be cut is `kit.oneLine`**, never a Text with
  `wrap="truncate-end"`. The surface's cut ends in `…`, which a CJK
  terminal draws two columns wide, so the ascii tier clips the line to its
  row instead.
- **A Button holds text alone.** It has no icon prop and no children but its
  label, so a button's icon is a glyph.
- **Every program the band runs is named in full where it runs.** Each
  `$.process.run` call spells out its command as a fixed list, never an
  argv handed through a helper, so a reader and the plugin directory's checks
  see the program at its call. A new command, or a new hook, goes in the
  plugin README's *What it runs, reads and sends* and in `SECURITY.md` in the
  same pull request: the directory holds a mod for review until its README
  says what it runs and what each hook does.
- **Atoms are declared in `register.tsx`.** They are the band's state in the
  engine's store, and they belong with the hooks that read and write them.
- **Colour is never the only signal.** Escalation also adds words or
  `!` / `!!`. In the dark and light palettes, text meets WCAG AA contrast
  (4.5:1) and edges and tracks meet 3:1. A text track's empty cells take
  `trackInk`, which meets 3:1 on every ground they sit on.
  `tests/contrast.test.ts` checks both palettes; plain takes the theme's own
  colours.
- **A new layout** is:
  1. Its name in `LAYOUT_NAMES` (`hooks/snapshot.ts`), which stays one line
     of quoted lower-case words, `export const LAYOUT_NAMES = ['chips', …] as const`:
     the views gate reads it there.
  2. `hooks/views/<name>.tsx`, which exports `<name>View`, a `View`
     (`views/view.ts`): its `rows` on the desktop and in the terminal, its
     `collapsed` row, what it `open`s, and `minColumns` if it needs more
     than 40 (below them the band draws chips). Its other files are
     `<name>-*.tsx`. It shares only `views/view.ts`, `views/frame.tsx`
     (`drawView` puts its parts together; `bodyRowsFor`, `rowRoom`,
     `footer`, `topStrip`, `line`, `fitLine` with `Keeps` and `PieceOf`,
     `groundOf` and `pieceGap`) and, for cards, `views/shell.tsx`.
  3. Its entry in `VIEWS` (`hooks/views/index.ts`), on these two lines
     exactly: `import { <name>View } from './<name>'`, and
     `<name>: <name>View,` indented two spaces.
  4. What it is for in `LAYOUT_PURPOSE` (`hooks/command.ts`), which
     `/nextcost layout` lists. The type check fails without it.
  5. `tests/view-<name>.test.ts`, which calls `viewSuite('<name>')`. Chips
     has none: golden holds its trees.
  6. Its title and caption in `LAYOUT_LABELS` (`tools/demos/stills.py`),
     without which the build stops. The capture draws every layout in
     `LAYOUT_NAMES`, and the site's layout buttons and the names it lists
     come from what it draws.
  7. Its row in the plugin README's Layouts table, its name and the count
     of layouts in both READMEs and the galleries' alt text, and its files
     in this file's table. Then rebuild the demos (`tools/demos/build.sh`).

  Every layout draws only words from `read`. `tools/views-gate.sh` holds
  every file in `views/`, `.ts` and `.tsx`, chips' included, to these rules:
  - `views/` is flat: a `.ts` or `.tsx` in a folder under it fails.
  - None contains `.raw`, `.reading.`, `Date.parse`, `.replace(`,
    `Math.round`, `.toFixed(`, `.toLocaleString(` or `Intl.`, or names the
    `format` module by any relative path, in any quoting, with or without
    a suffix, in an import, an export's `from` or `import()`.
  - Each belongs to a layout, as `<name>.tsx` or `<name>-*.tsx` (or `.ts`),
    or is shared: `frame.tsx`, `shell.tsx`, `view.ts` or `index.ts`.
  - Each name in `LAYOUT_NAMES` has its `<name>.tsx` and both lines in
    `index.ts` above.
  - Every layout but chips keeps its own look: its files, `frame.tsx` and
    `shell.tsx` import nothing from chips' files (`chips.tsx` and each
    `chips-*.tsx`) and never say pill or meter, alone or ending a name
    (`cachePill`), or battery anywhere, comments included.
  - No hook but `kit.tsx` writes an `<svg` root.
- **Test first.** Write the failing test, watch it fail
  (`tools/test-only.sh <name>`), then make it pass, then run the whole
  suite.
- **Settle on the clock.** Work a hook starts without awaiting finishes
  under the mocked clock: `await clock.settle()`, never a spin of
  microtasks. A test that walks the clock through many minutes takes the
  `LONG` budget from `helpers.ts`: the band ticks every second, and CI
  runners are several times slower than a laptop.
- **Chips' trees are frozen.** `golden-a` and `golden-b` hold chips to the
  trees it draws as its 0.13 board does, its open view its four cards: dark
  and plain, desktop and terminal, at 40, 95 and 200 columns, shut and open;
  and every dark terminal frame's hover cards to whole pieces (`tests/cover.ts`).
  They are the two halves of `GOLDEN_SCENARIOS` (`tests/cases.ts`), which
  `goldenSuite(0)` and `goldenSuite(1)` (`tests/golden/suite.ts`) split
  between them, so neither file names a scenario.
  A clock time is the host's zone's, which the kit can't pin, so the hash
  reads every clock time alike (`tests/golden/hash.ts`); the readings' tests
  hold each to its zone. No tool recaptures the trees, so a change meant to
  alter what chips draws re-freezes them by hand: update the failing keys
  in `tests/golden/chips.ts` to the hashes the failures print. For a key
  also held in `GOLDEN_TREES`, replace its whole tree too: log
  `JSON.stringify(canon(tree))` for that key in `tests/golden/suite.ts`,
  paste the output in, and drop the log. Say why in the pull request.

## Demos and the website

Every demo in `docs/` (the film, the GIFs, the landing page's live band and
its states, the social card, the states and layouts galleries) is drawn
from the band's own output. `docs/issue-toggle.png` is no demo: it is an
annotated screenshot kept for an upstream issue, which the build leaves
alone. After a change that alters
how the band reads, rebuild them with `tools/demos/build.sh`; see
[tools/demos/README.md](tools/demos/README.md). Edit the landing page in
`tools/demos/site/template.html`, never in `docs/index.html`.

## Commits

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `style:`, `refactor:`, `docs:`, `test:`, `chore:`. The
subject says what changed. The body, when there is one, says why.

## Before you open a pull request

1. Bump `version` in `plugins/nextcost/.claude-plugin/plugin.json`,
   following [Semantic Versioning](https://semver.org/).
2. Add an entry to `plugins/nextcost/CHANGELOG.md`.
3. Update the plugin's README if the band reads differently, and its *What
   it runs, reads and sends* and `SECURITY.md` if it runs, reads or hooks
   anything new.
4. Make sure validate, test, the type check, the views gate and, if you
   touched `tools/`, the lint all pass.

After merge, the maintainer tags the release with
`claude plugin tag plugins/nextcost`.

nextcost is submitted to Anthropic's plugin directory, which follows
`main`: GitHub tells it of each push, and it scans what it finds. Since
nextcost is a mod, every new version waits for an Anthropic reviewer before
it goes live there, so a release reaches the directory later than the
marketplace install. A change to what the band runs, reads or hooks without
the README saying so holds that version back.

## Pull requests

Keep a pull request to one change, and fill in the template's checklist.
For anything visual, include a screenshot of the desktop band, collapsed
and expanded.
