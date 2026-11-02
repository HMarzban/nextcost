<div align="center">

# nextcost

**The price of your next Claude Code message, before you send it.**

**nextcost** is a free Claude Code plugin that draws a live band
above the prompt: the prompt-cache countdown, what a re-warm will cost, the
session's spend, context fill, and your 5-hour and weekly limits. In the
terminal and the desktop app; no tokens, no network calls.

[![CI](https://github.com/HMarzban/nextcost/actions/workflows/ci.yml/badge.svg)](https://github.com/HMarzban/nextcost/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/HMarzban/nextcost?display_name=release&label=release)](https://github.com/HMarzban/nextcost/releases/latest)
[![License: MIT](https://img.shields.io/github/license/HMarzban/nextcost)](LICENSE)

[Website](https://hmarzban.github.io/nextcost/) · [Install](#install) · [What it shows](#what-it-shows) · [How it works](#how-it-works) · [FAQ](#faq) · [Contributing](#contributing)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/band-film-dark.gif">
  <img alt="The band in the Claude desktop app: after the last reply the cache counts down from an hour, turns amber in its last minute with the re-warm price, goes cold showing what the next message will cost, then opens its cards. Every frame is drawn from the band's own output, with the clock moved forward" src="docs/band-film-light.gif">
</picture>

## Why

While Claude Code's prompt cache is warm, each message re-reads the
conversation on Anthropic's side at a fraction of the input price: 0.05× on
Opus 5.5 and Sonnet 5.5. Step away longer than the cache lasts (5 minutes or
an hour after the last request) and your next message writes the whole
conversation to the cache again, at 2× base input on the hour's cache and
1.25× on five minutes. On the hour, that makes the context part ~40× the warm
read on Opus 5.5 and Sonnet 5.5 (~80× on Fable 5.1, ~20× on Haiku 5.5); on
five minutes, ~25× (~50× on Fable 5.1, ~12.5× on Haiku 5.5). Output and new
input cost the same either way. On Opus 5.5, on the hour, 300k tokens of
context is ~$2.40 to write against ~$0.06 to read.

**nextcost** shows the countdown and the price, and keeps your
spend and limits in view while you work. When Claude Code compacts an idle
session instead of letting its cache go cold, the band says so and prices
the summary.

## Install

**Needs** Claude Code with mods (function-hooks plugins), outside WSL, which
doesn't load plugins. CI tests every change, in the terminal's engine, on
Claude Code 2.1.299 and the latest release (2.1.316 at 0.21.0). The one-line
install below needs 2.1.292 or later
(`claude --version`); on an older one, use the two steps underneath.

One command, in any terminal:

```bash
claude plugin install nextcost --marketplace HMarzban/nextcost
```

It loads in your next session, or run `/reload-plugins` in an open one. The
band appears above the prompt. A new conversation reads `cache warming` until
Claude's first reply, `cache warm` while Claude is replying, then counts
down from `cache 1h 00m` (or `cache 5:00` on a five-minute cache). A session
that was already open may read `cache –` until Claude's next reply. Hid it
(`Hide band`, key `h`)? `/nextcost` brings it back. Nothing above the
prompt? Check the Needs line above (mods, and WSL), or
[open a bug report](https://github.com/HMarzban/nextcost/issues/new?template=bug_report.yml).

The band draws in the terminal and in the desktop app's Code tab, and a
plugin installed from either is available in the other.

**Had `session-usage-band`?** That was nextcost's name before 0.18.0, and
this repository was `claude-mod`. Swap the old plugin for the new one:

```bash
claude plugin uninstall session-usage-band@hossein-mods
claude plugin marketplace update hossein-mods
claude plugin install nextcost@hossein-mods
```

`/usage-band` and the `CC_BAND_*` settings still work. Your chosen layout
and the week of limit readings start afresh.

<details>
<summary>Inside a session, on an older Claude Code, or for a whole team</summary>

**Inside a terminal session** (Claude Code 2.1.275 or later). It asks you to
confirm adding the marketplace, then opens the plugin's details, where you
pick a scope:

```
/plugin install nextcost --marketplace HMarzban/nextcost
```

**Before Claude Code 2.1.292**, the one-line form isn't there. Use two steps:

```bash
claude plugin marketplace add HMarzban/nextcost
claude plugin install nextcost@hossein-mods
```

**For a team**, commit this to the repository's `.claude/settings.json`.
Once a teammate trusts the folder, Claude Code fetches the marketplace in the
background and turns the band on. It needs no install command, since the band
loads straight from the marketplace. If it isn't showing yet, run
`/reload-plugins`:

```json
{
  "extraKnownMarketplaces": {
    "hossein-mods": { "source": { "source": "github", "repo": "HMarzban/nextcost" } }
  },
  "enabledPlugins": { "nextcost@hossein-mods": true }
}
```

</details>

<details>
<summary>Update or uninstall</summary>

```bash
# update, then quit and reopen Claude Code (Cmd+Q on the desktop):
# /reload-plugins doesn't load a new version
claude plugin marketplace update hossein-mods
claude plugin update nextcost@hossein-mods

# uninstall
claude plugin uninstall nextcost@hossein-mods
claude plugin marketplace remove hossein-mods
```

</details>

## What it shows

![The chip row, labelled: the cache countdown and what a re-warm will cost, the session cost, context toward auto-compaction, the 5-hour limit with its pace, the weekly limit and its reset, and the toggle that opens the cards](docs/band-anatomy.png)

- **Cache**: time until it goes cold, and the re-warm price in its last
  minute; `compacted` once Claude Code has compacted an idle session
- **Cost**: the session's total
- **Context**: how close auto-compaction is
- **5h**: your 5-hour limit, and whether your pace runs out first
- **7d**: your weekly limit and its reset

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/band-states-dark.png">
  <img alt="Four real states of the band: calm just after a reply; the cache's last minute with the re-warm price; near auto-compaction with the room left; and everything at once, with context, the 5-hour pace and the weekly limit all amber on one row" src="docs/band-states-light.png">
</picture>

They play live, with a guided tour, on the
[website](https://hmarzban.github.io/nextcost/).

Prefer another shape? `/nextcost layout <name>` draws the same readings
in one of three [layouts](plugins/nextcost/README.md#layouts),
each asking one question of them: `chips` (as above, is anything wrong
right now?), `pulse` (the session's trace: is my cost per message rising,
and will a limit fill before it resets?) or `departures` (a split-flap
board: when does the cache go cold, and when does each limit reset or
fill?).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/band-layouts-dark.png">
  <img alt="The three layouts on the desktop, one panel each, drawn twice from the band's own output, calm and in the cache's last minute: chips, pulse and departures" src="docs/band-layouts-light.png">
</picture>

In every layout a reading turns amber when it needs you: the cache's last
minute, context near auto-compaction, a limit at 80% or a 5-hour pace that
would run out before the reset. Nothing is ever red. In chips on the
desktop, hover any chip for a one-line explanation.

Resume or fork a session (`claude --resume`, `/resume`, or a past session
in the desktop app) and the band picks up its cache and spend where they
were ([how it reads them](plugins/nextcost/README.md#reopening-an-old-session)).

Press `▵` to open every fact, with a line that says where you are: the
project, its git branch or worktree, uncommitted changes and ahead/behind.
Chips opens into four labelled cards, that line above them when the band
has the rows, else beside the buttons. Pulse opens into four cards, each
with its chart, and departures into an ITEM, STATUS, TIME and REMARKS
board, both with the line beside the buttons.

![The band expanded on the desktop: chips for the cache, cost, context and the 5h and 7d limits, then the Cache, Spend, Context and Limits cards, the project path and branch, and the Collapse and Hide band buttons](docs/band-expanded.png)

In the terminal it's text, and pieces give way, least important first, as the
window narrows:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/band-demo-terminal-dark.gif">
  <img alt="The same story in a terminal: the countdown, the amber last minute, the cold cache and the cards, as text" src="docs/band-demo-terminal-light.gif">
</picture>

The [plugin's README](plugins/nextcost/README.md) covers every chip,
card, command and setting.

## How it works

It's a **mod**: a Claude Code plugin written with the function-hooks API.
A `ui.render` hook draws the band above the prompt, and the other hooks watch
turns, steps and compactions. It's TypeScript and JSX, with no dependencies,
no build step and over 1,200 tests.

- **The price comes from your own bill.** No pricing table is reachable from
  a mod, so the band solves the base rate from the session's cost and token
  counts. Each kind of token is a fixed multiple of input:

  ```
  cost = rate × (uncached + 1.25 × written for 5m + 2 × written for 1h + read share × read + 5 × output)
  ```

  where read share is the cache-read multiple: 0.1, or 0.05 on Opus 5.5 and
  Sonnet 5.5 and 0.025 on Fable 5.1 and Mythos 5.1. Claude Haiku 5.5 pays
  5× every price on a prompt over 100k tokens, so the band weighs each
  request at its own tier.

  A re-warm is then the whole context written to the cache again, at 2× on
  the hour's cache and 1.25× on five minutes, or the summary after a
  compaction.
- **It remembers across sessions:** the layout you chose, when each session
  last had a reply and the model it was billed under, the rate it solved
  for each model, and a week of 5-hour and weekly readings for pulse's day
  cells. A reopened session reads what it
  spent from its transcript.
- **It spends nothing and sends nothing.** It never calls a model, never
  writes files and never sends anything anywhere. Besides two read-only git commands for
  the workspace line, it runs only `grep` and `tail`, to read a
  session's own transcript. The plugin README's
  [What it runs, reads and sends](plugins/nextcost/README.md#what-it-runs-reads-and-sends)
  names each command and what each hook does, and [SECURITY.md](SECURITY.md)
  lists exactly what it reads.

## FAQ

**Does it cost tokens?** No. It never calls a model, and it never suggests
sending a message to keep the cache warm. That would mean burning tokens to
avoid burning tokens.

**Is the re-warm price exact?** It's an estimate, always shown with `~`. The
band solves the per-token rate from the session's own bill, weighing each
cache write as Claude Code's ledger bills it: 2× base input on the hour's
cache, 1.25× on five minutes. Until the cache shows its lifetime, the band
assumes the hour.

**How does it know if my cache lasts 5 minutes or an hour?** It can't read
your billing, so it assumes an hour and corrects itself to 5 minutes if it
sees the cache rebuild sooner. On a resumed session, the transcript's last
cache write says which until the band's first reply. Set
`CLAUDE_CODE_PROMPT_CACHE_TTL=5m` or `1h`, or `"promptCacheTtl"` in
settings.json, to remove the guess.

**What if Claude Code compacts while I'm away?** In a terminal session on
the hour's cache, Claude Code compacts a long conversation left idle about
54 minutes. The band warns that it may, then reads `compacted`, calm, with
what the next message costs to write the summary.

**How is it different from ccusage or a status line?** ccusage reports
from past logs, and some status lines show a cache countdown. This band
shows the re-warm price live, solved from the session's own bill, in the
desktop app as well as the terminal, with no tokens and no network calls.

**Does the 5-hour pace include my other sessions?** Yes. The limit is shared
across all your Claude use, so the pace counts every session and device.

**Does it work on light themes?** Yes. Set `NEXTCOST_APPEARANCE=light`, or
`plain` for theme colours only. `NO_COLOR` is respected. Set it in the
shell you start Claude Code from (`export NEXTCOST_APPEARANCE=light`, then
`claude`); the band reads it when a session starts.

**The row runs past the edge of my terminal.** Some terminals draw the
band's glyphs (`█ │ · Σ`) two columns wide. In a Japanese, Chinese or
Korean locale the band draws ASCII by itself; otherwise set
`NEXTCOST_GLYPHS=ascii`, which also suits a screen reader.

## Contributing

This is a young project, and the best way to improve it is to hear what you
see in your own sessions.

- **Something looks wrong**, such as a price that seems off, a chip that
  wraps or a band that doesn't draw:
  [open a bug report](https://github.com/HMarzban/nextcost/issues/new?template=bug_report.yml).
  A screenshot of the band helps most.
- **Something you wish it showed:**
  [suggest a feature](https://github.com/HMarzban/nextcost/issues/new?template=feature_request.yml).
- **You'd like to build it:** pull requests are welcome.

### Good places to start

- **The tokens chip hides too early on the desktop.** Chips' row fits by
  `fitLine` (`hooks/views/frame.tsx`) against `columns - ROW_SLACK`.
  `DESKTOP` (`hooks/layout.ts`) estimates text width roughly, so the row
  keeps `ROW_SLACK` spare and the tokens chip, first to give way, drops
  before it has to. Calibrating that estimate from screenshots would let it
  show.
- **Screenshots** of the light palette, a narrow terminal or a cold cache
  for the docs.
- **A new mod.** This repo is a marketplace: add your own plugin under
  `plugins/` and list it in `.claude-plugin/marketplace.json`, then run
  `claude plugin validate .`, then `claude plugin validate` and
  `claude plugin test` on your plugin's folder. The tooling targets
  nextcost today: CI, the views gate, the single-test runner and the demo
  builder all name `plugins/nextcost`, so run those checks on yours by hand.

### Development loop

```bash
git clone https://github.com/HMarzban/nextcost.git
cd nextcost
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the gates, the loop for seeing a
change live, the module map and the rules the code follows.

<details>
<summary>Repository layout</summary>

```
.claude-plugin/marketplace.json     the marketplace index (named hossein-mods)
plugins/nextcost/
  hooks/                            the band: the hooks, the readings and the three layouts
  tests/                            the test suite
  CHANGELOG.md                      what changed in each version
docs/                               the website (GitHub Pages) and the images in this README
design/                             the layout specs the code cites; finished plans in design/archive/
tools/                              the demo builder, the views gate, a single-test runner
.github/                            issue and pull request templates, CI, Dependabot
```

Every module, test helper and tool is in
[CONTRIBUTING.md's module map](CONTRIBUTING.md#how-the-code-is-laid-out).

</details>

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md). To
report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Hossein Marzban
