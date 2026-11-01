# Changelog

Every notable change to nextcost (session-usage-band before 0.18.0). The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Before
1.0.0, a minor version may change how the band reads.

## [0.20.0] - 2026-11-01

### Added
- Chips' open Cache card says who restarted the countdown when you didn't: `kept warm by · background task` when a background task's notification, another Claude session's message, a schedule or a channel message started a turn within the cache's lifetime, `re-warmed by · background task` when that turn rebuilt a cold cache, and once the cache has gone cold again, `last turn by · background task`. Where the card has no row to spare, as in the desktop's two lines of cards, its headline says it: `59m left · by background task`. The cache pill's hover ends the same way: `; a background task re-warmed it`. Your own next turn takes the line away. Pulse and departures don't show it yet. In two long sessions checked, turns nobody typed came to $20.87 of the $37.26, at list price, spent rebuilding cold caches, while the countdown seemed to restart by itself. The band learns where each prompt came from through a new `prompt.submit` hook, which reads only its origin, never its text, and passes every prompt on unchanged; the README and SECURITY.md say so.

### Fixed
- A re-warm on the hour's cache is priced as Claude Code's ledger bills it: an hour-long cache write at 2× base input, not 1.25×. The band priced every write at 1.25×, so on the hour it under-priced a re-warm by 1.6×, a 623k-token Opus 5.5 re-warm at ~$3.11 where it costs $4.98, and solved the price per token from writes weighed too light. The main conversation's writes now weigh by its cache's lifetime and a subagent's by its own, five minutes unless `subagentPromptCacheTtl`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` or `ENABLE_PROMPT_CACHING_1H` asks an hour; a reopened session's replies count at the split their usage logs. Checked against a session's cost record: priced this way, its 412 transcripts come to $613.83 against the ledger's $613.84. The settings read now keeps `subagentPromptCacheTtl` too, and the README and SECURITY.md say so.
- A reply that used the advisor no longer doubles the cache's size. Anthropic's usage for a reply with a server-side tool loop adds up every round, each reading the conversation again, so the band read about twice the context: the re-warm price doubled, the next message counted as an unexpected rebuild, and the advisor's own round, billed but missing from the usage, raised the price per token every later re-warm was priced at. In one long session the advisor's rounds were $117.99 of its $613.84 bill, and the rate read 25% high. The band now measures the cache by one round's share and keeps that reply's bill out of the rate, which leaves the rate there within 1%. It needs Claude Code 2.1.290 or later, which says how many tool calls Anthropic ran.
- A reopened session no longer counts its cache down from an API error. Claude Code logs a limit hit, a lost connection or an expired login as a reply on the model `<synthetic>` with no tokens, and the band took the last of these for the session's last reply: it showed a cold cache as warm and priced its re-warm under no real model. Those lines are skipped, and a step that sent no tokens leaves the countdown as it was.
- Chips' 5-hour pill no longer shows its fill forecast as a bare time. Cut short, `5h 76% ~1h 15m` read like a reset beside Claude Code's `Resets in 2h`, though it was when your pace fills the window. It now says `5h 76% full ~1h 15m`, and the pill's hover ends `; full in ~1h 15m at the current pace`. The forecast draws the last half hour's pace straight on, so a burst of work fills the window sooner: one session hit its 5-hour limit about an hour before its 76% reading at 18:58 foretold. Pulse's and departures' amber short form, `! 5h ~40m`, is unchanged for now.
- On the five-minute cache, an assumed hour corrects itself. The band switched to `5m` only when a request after five idle minutes read nothing from the cache, but a cold request still reads the system prompt that other sessions in the same folder keep warm (about 44k tokens). So it counted an unexpected rebuild and kept counting down from an hour, about 50 minutes too long. A short read after five idle minutes now means five minutes, and a later read of nearly all of it after five idle minutes means an hour again, as when a subscription moves off usage credits.

## [0.19.0] - 2026-10-22

### Fixed
- The auto-compaction toast speaks after a context warning too. The window's warnings and the ones toward compaction each keep their own level, so a toast at 85% of the window no longer silences `Auto-compaction in ~14k tokens` until the context falls under 75%. Neither speaks again when Claude Code gives and drops the compaction point by turns, where `Context is 85% full.` spoke on each return to the window's scale.
- A reset's countdown turns on time. The band repaints as each reset's minute turns, and where the time zone isn't known, the departures board's last minute, `IN 47S`, counts every second, and a reopened session's `idle for`, on chips' Cache card, turns with its minute; before, any of them could lag up to a minute.
- A reset under ten minutes off reads in whole minutes rounded up, as the board counts it: `in 5m` at 4:30, where chips, pulse and the cards said `in 4m`.
- A reloaded session on a model alias, such as `haiku` or `opus[1m]`, prices its re-warm at the model it was billed under, Haiku 5.5's upper tier included, without reading its transcript. The band's store now keeps that model's name beside each session's last reply, and each rate under it as before, so a reload finds both. Before, each reload of such a session read the transcript again, and where it couldn't, priced the re-warm in tokens. A session whose last reply came before 0.19.0 reads its transcript, as before, until its next reply.
- A reopened session counts its cache down from the main conversation's last reply, and prices its re-warm at the main conversation's model. A subagent's reply logged last no longer stands in for either.
- A load where Claude Code reports no cost is no longer taken for a new conversation: the cache shows as recalled, or not yet measured, rather than `cache warming`.
- A context window or compaction point of 0 reads 0%, never `NaN%`, and speaks no `Infinity% full` toast.
- `/nextcost` and the band's once-a-second repaint are in place as a session starts, before any slow read, and a failure while the session starts no longer leaves the band without them or stops the session. The appearance, the glyphs, the cache's lifetime and idle compaction are read before the band recalls a last reply off the transcript, so a slow recall no longer leaves them unset.
- A reading that can't be drawn no longer breaks the band: chips is drawn in its place, and if chips can't be either, the band steps aside and the prompt draws as usual.
- A turn that cost nothing keeps the last real message cost, the same in every layout. Chips and departures dropped it while pulse kept it.
- A text split bar, in chips' open Spend card in the terminal and in plain, fills its width exactly; it could run a cell past its card.
- Wide (CJK) project and branch names stay in the ascii tier, which dropped them, and every line counts them two columns, so the workspace line and a clipped name keep to their room.
- In the dark and light palettes, a text meter's empty cells, the cache's track and a day not yet measured meet 3:1 contrast on every ground. They read at 1.2 to 1.5:1.

### Changed
- Each command the band runs is now fixed text at its call, but for the transcript's path and the offset it reads from: `tail -c 1048576` and `grep -a -b -F '"type":"cost-state"'` are written out where they run. The settings read keeps `promptCacheTtl` and `idleCompaction` at the call and drops the rest there, `env` included. The README says how nextcost can and can't send anything out, and that it reads no credential. Nothing the band runs or draws changes.
- A view now calls for the history, week and board (`read.week()`) rather than reading a getter, so reading a property never runs code. Each is still built only when a view asks, and once.
- Inside, each rule has one home, and nothing else the band draws changes. `/nextcost` makes a plan that the hooks carry out; the toasts, the transcript's reads, the list prices (`prices.ts`), the cache's settings (`cache-settings.ts`), the readings' facts (`facts.ts`), the departures board's words and chips' own (`chips-words.ts`) each have a module of their own; pulse builds each chart in one place (`pulse-charts.tsx`); the cache and the insights are one each per session; the snapshot has one pure builder; and every collapsed row gives way by one engine. The views gate reads every view, chips' included, and the layouts' own list. The type check also refuses unused locals, implicit returns, switch fall-through and an unmarked override.
- The tooling: the dead golden capture and sign-off tools are gone, the demo scripts share one module, and the demo captures are type-checked. CI pins its actions by SHA, cancels a pull request's superseded runs, times out, and lints the tools with shellcheck and ruff; Dependabot watches the actions. The tests are named by the behaviour they hold, and their project is `nextcost`.

## [0.18.2] - 2026-10-20

### Changed
- The plugin's listing reads as nextcost, lowercase, and links where it should: its homepage is the site, its documentation the plugin README, and its privacy policy SECURITY.md, which lists everything nextcost reads and keeps. Nothing the band does changes.

## [0.18.1] - 2026-10-20

### Added
- An icon, the site's amber trace on its dark ground, for the plugin's listing.
- The README says what nextcost runs, reads and sends, and what each of its hooks does: four read-only commands (two of git's, and `tail` and `grep` on a resumed session's own transcript), nothing sent anywhere.

### Changed
- Each command the band runs is named in full where it runs it, so a reader, or a directory's checks, sees every program at its call. Nothing the band runs or draws changes.

## [0.18.0] - 2026-10-20

### Changed
- The plugin is now **nextcost**, after what it tells you: what your next message costs. The repository is `HMarzban/nextcost` (it was `claude-mod`), the plugin installs as `nextcost@hossein-mods` (it was `session-usage-band`), and the command is `/nextcost`; `/usage-band` still works. The settings are `NEXTCOST_APPEARANCE` and `NEXTCOST_GLYPHS`; `CC_BAND_APPEARANCE` and `CC_BAND_GLYPHS` still work, and the new names win where both are set. The site moved to https://hmarzban.github.io/nextcost/. An install of `session-usage-band` keeps working from GitHub's redirect, but takes no update after 0.17.4: uninstall it and install `nextcost@hossein-mods`, as the README's Install says. The layout you chose and the week of limit readings start afresh, since they are kept under the plugin's name.
- The band says `nextcost` where it said `Usage band`: `nextcost shown.`, `nextcost layout: pulse.`, `Bring it back with /nextcost`. Nothing else it draws changes.

## [0.17.4] - 2026-10-20

### Fixed
- Departures' collapsed row fits at every width it draws in, in the plain appearance too. With all four readings amber below 80 columns, plain ran up to nine columns past the band's edge: `[CACHE][! 30S]  [CONTEXT][! 95%]  [5H][! 85%]  [7D][! 90%]` takes 65 columns where a 60-column terminal leaves 56, and filled's last step, dropping the modules' padding, gave plain nothing, since it has no ground. Plain now has a last step of its own: each reading is bracketed once and the readings sit a column apart, `[CACHE ! 30S] [CONTEXT ! 95%] [5H ! 85%] [7D ! 90%]`, each still led by its `!`. Wider rows read as before. The width tests now sweep every width from 60 to 200 in dark, light and plain, on both surfaces and glyph tiers, with or without the time zone.

## [0.17.3] - 2026-10-20

### Changed
- No change to how the band reads: every layout draws what 0.17.2 draws, as chips' frozen trees and the demos' captured frames hold. Inside, the readings' types say what each state has. A cache compacted while idle is a mood of its own beside cold, not a flag every phrase tests first, and the cache's words are one table by mood. The context is read either toward compaction, with where it compacts and the room left, or against the window alone. A limit is live or passed, and a passed one carries no pace, reset or fill, so its words need not mask them.

## [0.17.2] - 2026-10-20

### Fixed
- The departures board says when the 5-hour window fills at 80% and over too, as chips, pulse and the cards do. With a measured fill, a 5h at 84% read `! NEAR LIMIT` on the board while every other layout said `! 5h full in ~40m`; the board now says `! FULL ~14:20` (`! FULL IN ~40 MIN` where the time zone isn't known), its value in REMARKS. Without a measured fill it still says `! NEAR LIMIT`.

## [0.17.1] - 2026-10-19

### Changed
- No change to how the band reads: every layout draws what 0.17.0 draws, as chips' frozen trees and the demos' captured frames hold. Inside, each piece now lives in the module that owns it. `parts.tsx` is gone: chips draws its own pills and battery, and pulse and departures squeeze their rows with `frame.tsx`'s `fitLine`. A layout declares its collapsed row and what opens beneath it, and `drawView` puts them together. The kit builds every Svg. The cache model makes its own decisions about recall and idle compaction, and `/usage-band`'s words live in `command.ts`. The words read facts alone, never the raw snapshot. Readings no layout drew are dropped, among them the old open bands' words.

## [0.17.0] - 2026-10-19

### Changed
- Departures' collapsed row puts each reading on its own module, a panel of the board's dark ground: its code's tiles in its own colour, then its cell's, white or amber, with the band's background between modules, so `CACHE DEPARTS 17:24` and `SPEND $3.19` no longer run together. At its narrowest the modules drop their padding and keep their ground; in plain appearance they have no ground and stand two columns apart. Departures opens into one board with a title and the time now (`DEPARTURES … NOW 20:36`), quiet plain headings, ITEM, STATUS and TIME as flaps in aligned columns with tiles only where there are characters (no wall of empty tiles), remarks in plain dim text, a thin rule across the board between lines on the desktop, and the footer every layout draws: the workspace strip, `Collapse` and `Hide band`. The workspace leaves the board. Short of rows, the remarks give way first on the desktop, then the lines in the board's order; an amber line never does.

## [0.16.0] - 2026-10-19

### Changed
- Pulse's collapsed row puts each reading on its own tile, its name then its figure then its chart; pulse opens into four cards like chips', each with its chart. The tiles stand on chips' ground, 5h and 7d in their own tints, so the spend trace no longer reads as the cache's. Open, CACHE draws the hour from the last reply to cold as a track with now marked, and the re-warm price; SPEND each message's cost over their average, and the last message and the average; CONTEXT its trail under the compaction line, and how much is in context of the window and where it compacts; LIMITS the 5h window and the 7d by day side by side, and when each resets. Short of rows a card's chart steps down, two rows to one to none, before any card gives way; then the other limits, Context, Limits, the cache and Spend give way in that order, and an amber card never does.

## [0.15.1] - 2026-10-19

### Fixed
- Claude Haiku 5.5's two price tiers. A Haiku request whose prompt is over 100,000 tokens pays 5× every price, so a session whose context grew past 100k solved one rate between the tiers, and its re-warm read low: ~$0.08 where 151k written at the upper tier costs ~$0.09. The band now weighs each request at its own tier, prices a re-warm over 100k at the upper one, and prices what the cache saved at the tier each read paid. A reopened Haiku session's rate follows its last reply's prompt, since its cost record doesn't say which requests crossed. Other models have one tier and read as before.

## [0.15.0] - 2026-10-19

### Added
- Idle compaction. In a terminal session on the hour's cache, Claude Code (2.1.290 and later) compacts a long conversation left idle about 54 minutes, before its cache expires. Until then, the cache's card says it may be compacted at ~54m idle. Once it is, the cache reads `compacted`, calm, with what the next message costs to write the summary: `cache compacted · next ~$0.20` in chips, `COMPACTED` on the departures board, a flat trace in pulse. Before, the band kept counting down to a cold cache that was already given up, and turned amber in its last minute.
- The band follows `"idleCompaction": false`, `DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT` and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` as Claude Code does. It keeps one more key from your settings, `idleCompaction`.

## [0.14.1] - 2026-10-19

### Fixed
- A subagent's turn no longer erases what your last message cost. Since Claude Code 2.1.299 a subagent's turn raises `turn.start` too; the band took it for a new turn, so the main turn's cost could go missing. It now skips a turn that carries an `agentId`.
- The `promptCacheTtl` setting in settings.json pins the cache's lifetime, in Claude Code's order: after `FORCE_PROMPT_CACHING_5M` and `CLAUDE_CODE_PROMPT_CACHE_TTL`, before `ENABLE_PROMPT_CACHING_1H`. With `ENABLE_PROMPT_CACHING_1H=1` and `promptCacheTtl: "5m"`, the band counted an hour while Claude Code used five minutes. The band keeps that one key from your settings, nothing else.
- The warm cache's card says it expires an hour (or five minutes) after a request, not after a reply: the lifetime runs from when the request is sent.

## [0.14.0] - 2026-10-19

### Removed
- Six layouts: gauges, ledger, rings, tiles, week and forecast. A saved one draws chips, and `/usage-band layout` says so. Week's day cells now live in pulse, and forecast's clock times in departures.

### Changed
- Pulse is rebuilt as the session's trace: each message a beat, a heartbeat for the cache (still, not animated), context and the 5h window over time, and the week by day. Open, it is a grid of chart bands.
- Departures is rebuilt as a split-flap board. Open, each reading is a line: item, status, time and remarks. Below 60 columns it draws chips.
- Pulse and departures draw their readings in one order: cache, spend, context, 5h, 7d. As the row narrows, spend, context and 5h give way; the cache and the 7d never do.
- `/usage-band layout` lists the three: chips (at a glance), pulse (trends), departures (times).
- Departures turns amber at the same moments as every layout. Its `LAST CALL`, ten minutes before an hour's cache goes cold, is calm; only the last minute is amber, and a limit has no last call.

## [0.13.2] - 2026-10-12

### Fixed
- Forecast and departures name the same count of messages to compaction.
  With room for 11.4 messages, forecast said `~11` and departures `~12`;
  both now round up, as departures did.
- When the session's usage can't be read, the band steps aside for that
  draw. The hook used to fail, and the engine skipped and reported it.
- A limit sample that arrives late no longer overwrites a newer one taken
  in the same 15 minutes, so week's cells keep the later reading.

## [0.13.1] - 2026-10-12

### Fixed
- Times are right in every time zone, across daylight-saving changes too.
  A reset, a fill or `cold at` past a change of clocks said the time an
  hour off, or one that never shows (`02:20` the night the clocks spring
  forward). Each time is now read with the offset in force at it, and an
  idle band picks up a change within a minute, with no reply needed.
- In the week layout, on a week with a change of clocks, a day's rise
  could land in the day beside it and name the wrong busiest day. A 23- or
  25-hour day is now one day, two days never share a cell, and each day's
  rise stays put on every redraw. The 5-hour cells on that night name the
  hour twice, or skip one, as the clock does.
- Week named a different fill day than the band's own projection: never
  today, and from its own guess. It now names the forecast's fill, today
  included.
- Just after the weekly reset, the next one said `↻ Sat 13:30`, today's
  weekday at a time already gone. It now says `↻ next Sat 13:30`.
- A 5-hour fill past midnight said only its day, `full ~Sun`. It now says
  its clock too, `full ~Sun 01:00`, as its reset does.
- A window read `reset` up to a second before it reset.

## [0.13.0] - 2026-10-12

### Changed
- Every layout is redesigned in one language, chips': its pills, tints and
  icons, one bold figure to a reading, its words in label ink, amber moved
  to the front and led by `! `. Each layout asks one question of the same
  readings and draws only its answer, and every layout but gauges now
  takes one row, on the desktop and in the terminal:
  - `gauges`: how much room is left, and is it filling faster than the
    clock? Four bars on one scale in a 2×2 grid, the cache's a battery,
    each limit notched where its window's time has gone, then the cost.
  - `ledger`: one plain sentence, each reading bold on its figure alone,
    `│` between readings and `·` within one.
  - `rings`: chips' pills, each led by a small ring where its reading has
    a cap.
  - `pulse`: is my spending speeding up? Each message's cost and the last
    hour of the 5-hour limit drawn inside chips' pills.
  - `tiles`: one row of equal tiles, each its figure, its label and, where
    there's a cap, a bar or the cache's battery.
  - `week`: the weekly limit's seven day cells inside its pill, solid
    where measured, dashed where guessed, the day the guess fills it named,
    then chips' pills.
  - `departures`: how long until each thing goes, every reading a
    countdown in chips' pills, soonest first, `›` between them.
  - `forecast`: each reading's next change as a chip, its clock time the
    figure, soonest first.
- One shared inspector: `▵` opens every layout into the same four cards,
  Cache, Spend, Context and Limits, under the workspace line and the
  `Collapse` and `Hide band` buttons. Most layouts mark each card's head
  their own way, with its bar, ring or countdown, and no card repeats what
  the row above it says, though Limits' first row may name the worst
  window's reset again. As the row narrows and drops a fact, its card says
  it again.
- Formatting: dollars are grouped, `$1,027`, and tokens reach billions,
  `2.1B`. A card's head is bold on its figure alone, its words lowercase in
  label ink. Limits leads with the worst window's reset and pace, `resets
  Sat 13:30 · full before reset` (a countdown in departures), then names
  each other window on its own line, `5h resets 3h 00m · on pace for
  ~10%`. No fill ends in a bright thumb. The tokens chip comes last, and a
  limit's reset is in label ink, its pace not bold.
- Departures' amber moment: its `LAST CALL` was the cache's last minute.
  Its `! last call` now comes under 10 minutes before the cache goes cold
  or a limit fills, never before a reset, so it is the one amber moment
  that differs from every other layout's.

### Fixed
- A limit with nothing used could say `on pace for ~0%`. Its window may
  not have begun, so it has no pace until some of it is used.
- On the desktop in `plain` appearance, a chip lost the space before its
  bar.

### Removed
- Each layout's own open view: gauges' and rings' panels, ledger's columns
  of sentences, pulse's charts, tiles' groups, week's large cells and
  summaries, departures' ITEM, STATUS and TIME board and forecast's
  outlook rows. The shared cards take their place.
- Departures' split-flap row and its capitals, tiles' underline, week's
  second row and day initials, forecast's columns and weather icons.
- Inside, not on screen: the old view body path (`defineView`, the frame's
  body and panel), the section and grid helpers it laid out with, and the
  phrases only it read.

## [0.12.1] - 2026-10-11

### Fixed
- A chip's hover card drew on a ground close to the chips' own, with no
  edge, so it read as one more chip. Cards are now inverted, light on a
  dark band and dark on a light one, a ground no chip uses; in the
  terminal each card ends in half blocks that round its edges.
- A hover card could stop partway through a chip, leaving a bare `76` or
  `0%` beside it that read as a value of its own. A card now covers whole
  chips: it runs on to the end of any chip it enters, as one solid slab,
  and starts a column before its own, so in the terminal its rounded ends
  sit in the gaps; on the desktop that column absorbs some of the font
  measure's error. In the workspace strip a card covers whole pieces of its
  own side and stops a column short of the other's, so a long card no
  longer cuts the branch name into one that reads as another. In the
  footer the strip now runs up to the buttons, so its cards have the room
  they're given.
- On the desktop a hover card ran 150 to 255px of empty ground past its
  words, over chips the pointer couldn't reach while it showed. It is now
  sized from the desktop's font, about 0.8 columns a character, then
  rounded out to the end of a chip.
- A hover card covers its own chip, yet the cost card held no figure and a
  short row cut the reset time, the one fact left nowhere else. Every card
  now leads with its value, then what changes, then what it means:
  `Resets in 3h 00m; 5-hour limit, all your Claude use`, `$2.41 so far
  this session`, `76k of 200k (38%); older turns get summarized near
  full`, `152k of 160k (95%); auto-compacts in ~8.0k`, `52m left; warm
  cache bills input at 5%, expires 1h after a reply`.
- The expand toggle pointed the wrong way: the band is anchored to the
  prompt and grows upward when it opens, yet it showed `▿` to open and `▵`
  to close. It now points the way the band will move, `▵` to open and `▿`
  to close (`^` and `v` in ASCII), in every layout, on the desktop and in
  the terminal.
- In the terminal the toggle was drawn dim, the faintest thing in the row
  (about 3.8:1 on a light terminal, and some terminals draw faint text
  unpredictably) though it is the band's only open and close control. It
  now draws at full ink, about 12:1.
- The toggle sat on the top row in tiles, the bottom in gauges and the
  middle in forecast and rings. Since its arrow points toward or away from
  the prompt, it now sits on the row nearest the prompt in every layout.
- In the ascii tier, text too long for its box still ended in `…`, which a
  CJK terminal, the tier's own, draws two columns wide, so every narrow
  hover card and cut line overflowed its row. A hover card now cuts its
  own words, after the last whole one, with a `.`, and any other line
  clips at its row's last whole word.
- In the ascii tier `input 196k · output 12k` read `input 196k - output
  12k`, a subtraction, and a screen reader said "minus". A spaced ` · `
  now reads `, `; a bare `·` still becomes `-`.
- The Spend card's token split told input, output and cache reads apart by
  hue alone, inks too close in lightness to read under any colour-vision
  simulation. In the terminal each part now has its own fill, `█`, `▓` and
  `▒` (`#`, `=` and `+` in ASCII), and its legend mark matches; on the
  desktop each part ends a pixel short of the next, so the ground divides
  them.

## [0.12.0] - 2026-10-10

### Added
- Nine layouts, chosen with `/usage-band layout <name>`: chips, the band as
  it was and still the default, and eight more that show the same readings
  as labelled bars (`gauges`), words alone (`ledger`), rings (`rings`),
  trends (`pulse`), bold values (`tiles`), day and hour cells (`week`), a
  split-flap board (`departures`) and a weather-style outlook
  (`forecast`). Each opens with `▿` to its own view of every fact. The
  choice is kept for every session; below 40 columns every layout draws
  chips. `/usage-band layout` alone names the layout in use and lists
  them. The README's Layouts section gives each one's rows.
- The band keeps a week of 5h and 7d readings in its store, at most one per
  15 minutes, for week's cells.
- Glyph tiers in the terminal: `CC_BAND_GLYPHS=ascii` draws ASCII alone,
  for a terminal that draws ambiguous-width characters wide or a screen
  reader, and `CC_BAND_GLYPHS=unicode` keeps the band's own glyphs.

### Changed
- In the terminal in a CJK locale (`LC_ALL`, `LC_CTYPE` or `LANG` starting
  with `ja`, `zh` or `ko`), chips draws ASCII: such a terminal draws some
  of its glyphs two columns wide, so the row ran past the window's edge.
  `CC_BAND_GLYPHS=unicode` keeps the glyphs.

### Fixed
- A resumed session (`claude --resume`, `/resume`, or a past session opened
  in the desktop app) no longer reads as a new one: the cache shows cold or
  counting down, at the re-caching price Claude Code names and for as long
  as its last cache write was made for, and the spend and token breakdown
  start from what the transcript records, not $0.00.
- A reset countdown no longer stands a minute stale while the cache is
  cold, and a calm band repaints once a minute, not twice.
- Inside, not on screen: a turn that ends outside the main conversation
  drops any start cost it noted, so a subagent's turns can't build up.

## [0.11.13] - 2026-10-10

### Changed
- The plugin README links the website, where every state of the band plays
  live, and names Fable and Mythos 5.1's cache-read share beside the others.
- Installing is one command: `claude plugin install session-usage-band
  --marketplace HMarzban/claude-mod`, which adds the marketplace on the way.
  The repository README adds installing inside a terminal session and for a
  whole team, and keeps the two-step form for Claude Code before 2.1.292.

### Fixed
- In the terminal, a chip's hover card drew under the chips after it, so it
  read in fragments between them, and a card from a chip mid-row was cut at
  the row's right edge. On both surfaces each card now draws after every
  chip, at its own chip and slid left only as far as it must to end short
  of ▿. The workspace strip's cards draw after the strip too, each at its
  own piece.

## [0.11.12] - 2026-10-09

### Fixed
- Sonnet 5.5 reads its cache at 0.05× base input ($0.10 on $2), as
  Anthropic's pricing page lists it; the band weighed its reads at 0.1×, so
  on Sonnet 5.5 sessions the re-warm price read low and the hover said 10%.

## [0.11.11] - 2026-10-09

### Changed
- The plugin's description leads with what it answers: what your next
  message costs. The plugin README's images and links are full URLs, so
  they work wherever the README is shown, a directory listing included.

## [0.11.10] - 2026-10-09

### Fixed
- The re-warm price could still read about 30% low. `/model` may name the
  model by an alias (`opus[1m]`), which matched no read price; the band now
  prices tokens at the model each reply is billed under, as the API names
  it, and a reopened session at the model its last reply names in the
  transcript. The rate it remembers is filed under that model too.

### Changed
- The READMEs open with a picture of the band, label every chip in a
  diagram, and say where to report a bug or suggest a feature.

## [0.11.9] - 2026-10-09

### Changed
- `Hide band` is drawn as a plain button, like `Collapse`, no longer as the
  one to press: the calm band marks no main action, least of all hiding
  itself.

## [0.11.8] - 2026-10-09

### Fixed
- On a 1M-context session the re-warm price read about 30% low. `/model`
  names such a model with its window, `claude-opus-5-5[1m]`, which matched
  no read price, so cache reads were weighed at 0.1× rather than Opus 5.5's
  0.05×. The band now prices the model behind the name: the re-warm, the
  hover's read share, the rate it remembers and the rate it reads off a
  reopened session's cost record, which names the model alone.

### Changed
- The READMEs show the band on the desktop, expanded.

## [0.11.7] - 2026-10-09

### Fixed
- Inside, not on screen: CI passes. The tests that walk the clock through
  an hour (3,600 of the band's one-second ticks) take a 30-second budget,
  since a shared runner outran the default 5 seconds where a laptop takes
  under 2. CI runs on the current checkout and setup-node actions.

## [0.11.6] - 2026-10-09

### Fixed
- The Cache card's bar tells a screen reader the time left (`cache 80%
  left`), as the battery does; it said `used`, the reverse of what it
  shows.

### Changed
- The manifests name the repository, github.com/HMarzban/claude-mod, and
  the README installs from it: `claude plugin marketplace add
  HMarzban/claude-mod`.

## [0.11.5] - 2026-10-09

### Changed
- Documentation only, ready for the repository to go public: the READMEs
  name the versions the band was tested on (Claude Code 2.1.295, and the
  desktop app's bundled 2.1.289) and how to install from a clone;
  CONTRIBUTING describes the test helpers and the clock rule; the bug
  report form asks for current versions.

## [0.11.4] - 2026-10-09

### Fixed
- Numbers at a unit's edge are written in the unit they round to: 9,999
  tokens is `10k` (was `10.0k`), 999,999 is `1.0M` (was `1000k`), $999.995
  is `$1000` (was `$1000.00`), and an estimate from $1000 is whole dollars.
- A reset under a minute away reads `<1m`, not `0m`.
- A transcript line that merely names `cost-state`, such as a prompt quoting
  it, can no longer hide the real cost record, and an unreadable last record
  falls back to the one before it.

### Changed
- Inside, not on screen: the toast rule is one pure function, the engine
  side keeps its state in one object, and the shared helpers (a duration's
  wording, trailing slashes, a transcript's backward scan) exist once. The
  test suite starts each test with one `setup()`, draws with `mountBand()`,
  finds nodes with one `byKey()`, settles on the mocked clock, and has unit
  tests for the formatting, memory and toast modules: 255 tests, from 203.

## [0.11.3] - 2026-10-09

### Changed
- Inside, not on screen: the drawing is split into focused modules (icons,
  layout, the readings, the drawing kit, the workspace strip), every word
  about the cache comes from one table, and the cache's view for the band,
  recall included, is built in one place with one rule for "recalled". The
  expanded view is drawn only while open. `band.tsx` went from 1,183 lines
  to 715.

## [0.11.2] - 2026-10-09

### Fixed
- The light palette's card edges and bar tracks met only 2.2 to 2.8:1, under
  the 3:1 a non-text edge needs; they now hold at least 3.58:1 on every light
  surface. The contrast tests run over every palette, not only the dark one.
- The Limits card says the 5h pace the chip shows (`full in ~1h`), in the
  chip's amber; the two had projected from different spans and could
  disagree. One rule now sets every limit's tone.
- The cache's hover says what a warm read costs on the model in force
  (`bills input at 5%` on Opus 5.5), not a fixed 10%.
- The token split bar no longer names an SVG id, which a page shares: its
  end segments draw their own rounded ends.
- A failed usage read can't drop a turn's bookkeeping, and a failure in the
  compaction hook never stops a compaction.

### Changed
- The context in use is worked out in one place, so the band, its toasts and
  a recalled re-warm price always agree.
- CONTRIBUTING lists every module and the engine's rules in full, and says
  why CI can't type-check.

## [0.11.1] - 2026-10-09

### Fixed
- Cache reads are priced for the model in force: 0.05× base input on
  Opus 5.5, 0.025× on Fable and Mythos 5.1, 0.1× elsewhere. Solving the rate
  with 0.1× everywhere put Opus 5.5's at $2.97 per million input tokens
  where the list price is $4.00, so every re-warm estimate read about 26%
  low. On a real session's totals the band now solves to $4.02.
- Cache writes stay at 1.25×, as Claude Code's own ledger prices them,
  1-hour writes included, so the band agrees with the cost it shows. The
  README says when Anthropic's bill differs.

## [0.11.0] - 2026-10-09

### Added
- A reopened session, or the band reloaded mid-session, knows its cache
  before the first reply: `cache cold · next message ~$2.34` once the cache
  has expired, or the countdown from the last reply while it is warm. The
  Cache card adds how long the session has been idle.
- To know it, the band remembers each session's last reply and the price
  per token it solves for each model. For a session from before the band,
  it reads the end of the transcript once, its last megabyte by `tail`,
  whatever its size: the last reply's time and the cost record's dollars
  and tokens. It never trusts the file's time, since Claude Code writes to
  a transcript each time it opens a session.
- With no price known for the model, it names the tokens the next message
  rebuilds, never a guessed dollar figure.

## [0.10.4] - 2026-10-08

### Changed
- A card short of rows gives up its bar before any fact: the bar repeats
  what a chip already shows, so at the desktop's usual height the Context
  card says how much is in context instead of drawing only its bar. The
  bar returns once every fact fits beside it.

## [0.10.3] - 2026-10-08

### Changed
- The expand toggle shows outlined triangles, `▿` to open and `▵` to
  close, measured centred in the button to within half a pixel. The `⌄ ⌃`
  chevrons sat 5 px off the middle.

## [0.10.2] - 2026-10-08

### Changed
- The expand toggle shows full-height chevrons, `⌄` to open and `⌃` to
  close, in place of small triangles that drew as specks in the desktop's
  button. A Button holds only text, so its icon is a glyph.

## [0.10.1] - 2026-10-08

### Fixed
- On a band too short to give the workspace strip its own row (the desktop
  often gives about 13), the strip now takes the footer, in place of the
  "Bring it back" hint, instead of not showing at all.

## [0.10.0] - 2026-10-08

### Added
- A workspace strip opens the expanded view. It shows the project path,
  with home as `~` and the project's folder in bold, then the git branch,
  or `detached at <commit>`. It also shows `worktree of <repo>` in a linked
  worktree, the uncommitted change count or `clean`, and ahead/behind
  (`↑2 ↓1`). It has icons on the desktop and words in the terminal, and
  each piece has a hover explanation.
- When the strip is narrow, the path and branch shorten and the extras
  drop, least important first. When the band is short of rows, the strip
  is dropped before the cards lose their last fact.
- git is read at session start, after each of your messages and when you
  open the cards, never while drawing. With no repository, or git missing
  or slow, the strip shows the path alone. Only the newest read lands, and
  a read that fails keeps the last good one.

### Fixed
- The light palette's label colour now holds 4.5:1 on its own surfaces.
- The hint under the cards takes the host theme's colours, since it sits
  on the band's bare ground.
- The expand toggle is atomic again: two quick presses leave the cards as
  they were.

## [0.9.1] - 2026-10-08

### Changed
- The expand toggle is a framed native button on the desktop, like
  Collapse and Hide band, with a chevron: `▾` opens the cards and `▴`
  closes them. The terminal keeps a bare glyph.

## [0.9.0] - 2026-10-08

### Added
- Each card's title has an icon matching its chip: a bolt for Cache, the
  coin for Spend, the document for Context and the gauge for Limits. The
  hint has an info mark. Desktop only.

## [0.8.2] - 2026-10-08

### Changed
- A blank row between lines of cards, and one above the buttons.

## [0.8.1] - 2026-10-07

### Changed
- Bars have a thumb where the fill ends.

### Fixed
- Icons and bars no longer touch their text on the desktop. It drops
  whitespace-only text, so the gaps are now spacers.

## [0.8.0] - 2026-10-07

### Changed
- Bars no longer carry a pace tick. Pace is in words: on the chip when it
  matters, and always in the Limits card.
- Cards sit in lines that share the width equally, and card bars stretch
  to fill their card.
- A card's title and headline share its first line. When the band is short
  on rows, each card drops its least important facts first, so the buttons
  never scroll away.

### Fixed
- Cards stacked one per line, because their fixed widths came out slightly
  too wide.

## [0.7.1] - 2026-10-07

### Fixed
- Every meter reused one SVG clip id, which could clip card bars to the
  width of a chip.
- The collapse toggle no longer uses `⌃`, which reads as Control on a Mac.

## [0.7.0] - 2026-10-07

### Added
- Honest early states: `cache –` when the band loads mid-conversation, and
  `cache warming` only for a conversation known to be new.
- The Cache card shows what the cache has saved, and the Spend card has a
  legend (input, output, cache reads).
- A hint under the cards: `Bring it back with /usage-band`.

### Changed
- Context measures toward auto-compaction (`63% full`, then
  `95% full · compacts in ~8k`).
- Chips never shrink, so expanding can't wrap them, and the chip row is the
  same whether the cards are open or closed.
- Cards have uppercase titles and, on the desktop, a visible border.
  Labels, values, edges and bar tracks meet WCAG AA contrast.
- The Limits card leads with the window closest to its limit and states
  each window's pace in words.

## [0.6.1] - 2026-10-07

### Fixed
- The four cards share one row, with bars across each card.

## [0.6.0] - 2026-10-07

### Added
- An expanded view of four labelled cards (Cache, Spend, Context, Limits),
  with Collapse (`c`) and Hide band (`h`) buttons.

### Fixed
- Follow-ups from the 0.5.0 verification review.

## [0.5.0] - 2026-10-07

### Fixed
- Accuracy fixes from a team code review.

### Changed
- A clean-code pass across the modules.
- A full plugin README and a marketplace index.

## [0.4.0] - 2026-10-07

### Added
- 5h and 7d limit chips with a bar, a pace tick and the reset countdown.

### Changed
- Leaner labels: the cost, tokens and context chips drop their words.

## [0.3.1] - 2026-10-07

### Fixed
- The battery icon on the desktop.
- The tokens chip shows whenever it fits.

## [0.3.0] - 2026-10-07

### Added
- The cache chip as a battery that drains as the cache ages.
- Icons, a tokens chip, and a context chip that knows where
  auto-compaction runs.

## [0.2.1] - 2026-10-07

### Fixed
- The cost baseline holds across `/clear`, resumes and reloads.
- The row always fits on one line.
- The 5-hour pace counts all your Claude use.
- Other limits, such as a gateway's spend limit, are listed.
- The expanded line shows the 5h percentage.

## [0.2.0] - 2026-10-07

### Added
- A calm one-row band: the last message's cost and a 5-hour pace estimate.
- SVG meters on the desktop.
- Hover explanations on every chip.

### Fixed
- The band resets on `/clear`, with a cost baseline.

## [0.1.1] - 2026-10-07

### Added
- The first version: a live band above the prompt with context fill,
  tokens, cost, the rate-limit windows and a prompt-cache countdown.

