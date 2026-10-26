# Security

## What the plugin can reach

nextcost runs inside Claude Code's mod environment, with no DOM,
no Node and no network of its own. It only reaches what the engine hands
it:

- **Reads** the session's id, model and usage (cost, token counts, context
  fill and rate limits), the clock, the session's project root and
  repository root, and these environment variables: `HOME`,
  `NEXTCOST_APPEARANCE`, `NO_COLOR`,
  `NEXTCOST_GLYPHS` (and their names before 0.18.0, `CC_BAND_APPEARANCE`
  and `CC_BAND_GLYPHS`), `LC_ALL`, `LC_CTYPE`, `LANG`,
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H`,
  `FORCE_PROMPT_CACHING_5M`, `DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT` and
  `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`.
- **Reads** your merged Claude Code settings once when a session starts,
  and keeps two keys from them, `promptCacheTtl` and `idleCompaction`.
  Nothing else in them is kept, stored, drawn or logged.
- **Runs** two read-only git commands in the project root, for the
  workspace strip, exactly:
  - `git -c core.fsmonitor=false --no-optional-locks status --porcelain=v2 --branch`
  - `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel`

  They run at session start, after each of your messages, on a new
  conversation and when you open the cards. They never run while the band
  draws, and they have a 3-second timeout. The engine runs git with
  repository hooks off. `core.fsmonitor=false` stops git from starting a
  program a repository's own config names, and `--no-optional-locks` keeps
  it from taking the index lock. Besides `grep` and `tail`, below, the
  plugin runs no other command, though git itself still honours the rest
  of your git configuration.
- **Reads**, once when the band loads into a session it can't tell is new
  (reopened, reloaded, or one whose cost Claude Code doesn't report) and
  its store doesn't know the last reply's time or its model's rate, the end
  of that session's own transcript: at the path Claude Code gave when it
  said the session was resumed, else at
  `~/.claude/projects/<project>/<session id>.jsonl`, where `<project>` is
  the project root with every character but a letter or digit a dash. It
  reads its last megabyte, by `tail -c 1048576 <transcript>` with the same
  3-second timeout, or failing that the whole file, through Claude Code's
  own file read (`$.fs`), if it is 4 MiB or smaller. It keeps three facts
  from it: when the last reply was, the name of the model that reply was
  billed under, and the cost record's dollars and token counts for that
  model (else the current one), to price a token. Nothing else in the
  transcript is kept, shown or sent.
- **Reads**, once when Claude Code says a session was resumed or forked,
  that session's transcript, at the path Claude Code names or else at the
  path above, with the same 3-second timeout:
  - its cost records, by `grep -a -b -F '"type":"cost-state"' <transcript>`,
    then what was logged from the last on, by `tail -c +<N> <transcript>`;
    where grep can't run, the whole file if it is 4 MiB or smaller;
  - its last megabyte, as above.

  It keeps the spend it adds up from them (dollars, and the token counts of
  each kind), how long the last cache write was made for, and, where Claude
  Code gives no idle time, the facts above. Nothing else is kept, shown or
  sent.
- **Reads**, as each prompt is submitted, only where it came from (your
  own, a background task's notification, another session, a schedule),
  never its text, its attachments or its context, so chips' Cache card can
  say who restarted the countdown. It passes every prompt on unchanged and keeps
  that origin in memory alone, never in its store, until your own next turn.
- **Writes** two values to the session's own state: whether the band is
  hidden, and whether it's expanded. In the plugin's own store it keeps,
  across sessions, the time of each session's last reply and the name of
  the model it was billed under (the newest 50), the price per token it
  solved for each model, the layout you chose, and a week of your 5-hour
  and weekly limit readings (their percentages and reset times, at most one
  per 15 minutes).
- **Never** writes files, calls a model, or sends anything anywhere.

`claude plugin validate plugins/nextcost` lists every read and
write the module makes, so you can check this yourself.

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Please don't open a public issue. Report it privately on the repository's
[Security tab](https://github.com/HMarzban/nextcost/security/advisories/new)
("Report a vulnerability"). Include what you found, how to reproduce it, and the
plugin and Claude Code versions. You'll get a reply within a week.
