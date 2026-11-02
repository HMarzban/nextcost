# Demos

Every demo in `docs/` is drawn from the band's own output: the film (an MP4
and a GIF, each light and dark), the terminal GIFs (light and dark), the
landing page's live band and its states, the social card and the stills.
The drawings are the band's own; the sessions behind them are scripted by
the captures, with the replies, costs and limits set by hand.
`docs/issue-toggle.png` is no demo: it is an annotated screenshot kept for an
upstream issue, and the build leaves it alone.

```bash
tools/demos/build.sh            # rebuild everything into docs/ (about two minutes)
tools/demos/build.sh capture    # only re-capture the band's frames
```

It needs Claude Code, Google Chrome, Node 22+, Python 3 with Pillow, and ffmpeg.
It uses the first `python3` it finds that can import Pillow; set
`PYTHON=/path/to/python3` to choose one. It looks for Chrome where macOS
installs it; elsewhere, set `CHROME=/path/to/chrome`.

## How it works

1. **Capture.** `capture/*.test.ts` are not tests. The build runs them in a
   scratch copy of the plugin with one `claude plugin test` and keeps what
   they print: the band's drawn tree at each moment, with the clock moved
   forward and the session in a known shape. The site's live demo is its own
   set (`DEMO <layout> <state> <shut|open> <tree>` lines, kept in
   `out/demo.txt`): four states, each one session and clock drawn in every
   layout in `LAYOUT_NAMES`, so switching layout never changes a figure.
   The captures are type-checked with `tsconfig.json` (`tsc -p tools/demos`),
   which reads them as the plugin's own tests. A capture bills its replies
   as Claude Code's ledger does (a write on the hour's cache, which the
   captures pin, at 2×), since the band solves its price per token from the
   bill: a bill set any other way scales every re-warm it draws.
2. **Draw.** `render.py` turns a terminal tree into HTML on a monospace grid;
   `render_desk.py` turns a desktop tree into HTML laid out like the Code tab
   (10px per column, 24px per text row), with the band's real SVG icons.
   Both map a Box's flex props through `common.py`, which the scripts share
   for the capture's lines, a tree's text and the plugin's version.
3. **Compose.** `film.py` builds the film frame by frame in a light and a
   dark theme; `term_themed.py` the terminal demo's frames, which
   `terminal-timing.txt` holds each for its time; `gen_site.py` fills
   `site/template.html` with the live demo's drawings (`{{demo-chips-amber}}`
   and `{{demo-json}}`, drawn with `node(tree, site=True)`: real buttons,
   `alt=""` icons, the countdown in `<span class=cd>`), and with the layouts
   the capture drew: a line holding `{{layout-radio}}` is repeated with each
   layout's button, and `{{layout-names}}` lists them in words; `stills.py`
   the social card (from the real `chips amber` drawing), the chip row's
   anatomy, the expanded band, and the states and layouts galleries, each
   layout's row titled from `LAYOUT_LABELS`, which must name every layout the
   capture draws. The build also stamps `docs/sitemap.xml`'s `lastmod` with
   the build date (UTC).
4. **Render.** `shoot.mjs` screenshots the film's frames through one headless
   Chrome over the DevTools protocol; the terminal demo's frames and the
   stills go through `build.sh`'s `shot`, a headless Chrome `--screenshot`
   each. ffmpeg turns frames into MP4 and GIF.
5. **Cache-bust.** Last, `cachebust.py` gives every local asset
   `docs/index.html` names (the icons, the social card in `og:image`,
   `twitter:image` and the JSON-LD, the film and its posters) a `?v=` of its
   SHA-256's first 10 hex digits, from the files as the build left them. A
   changed file gets a new URL, so no cache keeps the old one: browsers'
   long-lived favicon stores and link-preview caches included. Running it
   again changes nothing.

To change the landing page, edit `site/template.html` and run the build (or
just `python3 gen_site.py out/site.txt site/template.html ../../docs/index.html`
then `python3 cachebust.py ../../docs/index.html ../../docs` after a capture). Don't edit `docs/index.html` by hand; the build overwrites it.

Scratch goes to `tools/demos/out/`, which git ignores.

A rebuild that changes nothing the band draws can still change the film's
MP4s and GIFs, a few shades at a time, and with them the page's `?v=`.
Before you commit a rebuild, compare each changed one's frames with the
committed one's (`ffmpeg -i <file> -f framemd5 -` on both, then look at any
frame that differs). Where only the encoding changed, restore it with
`git checkout -- <file>`, then run `cachebust.py` again so the page names
the committed files.
