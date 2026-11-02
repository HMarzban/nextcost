"""Build docs/index.html: the site template with the band's real desktop
output (from the test kit) rendered in as the hero's live band.

    python3 gen_site.py out/site.txt site/template.html ../../docs/index.html [out/demo.txt]

demo.txt (beside site.txt unless given) fills {{demo-chips-amber}}, the
hero's first drawing, and {{demo-json}}, every drawing as
{layout: {state: {shut, open}}} for <script type="application/json"
id="demo-data">. {{faq-json}} fills the JSON-LD FAQ from the page's own fine
print (the `<div class="q">` blocks), so the two can't differ. The layouts
are the ones it draws: a line holding {{layout-radio}} is repeated with each
layout's radio button, and {{layout-names}} lists them in words. site.txt
itself feeds the stills, not the page."""
import datetime
import html
import json
import os
import re
import sys

from common import demo_layouts, plugin_version, read, words, write
from render_desk import node


def lift_hovers(n):
    """Move each hidden hover card's words onto the piece that holds it, as
    `tip`."""
    if isinstance(n, list):
        for c in n:
            lift_hovers(c)
        return
    if not isinstance(n, dict):
        return
    keep = []
    for c in n.get('children') or []:
        p = (c.get('props') or {}) if isinstance(c, dict) else {}
        if p.get('position') == 'absolute' and p.get('display') == 'none':
            n.setdefault('props', {})['tip'] = ' '.join(words(c).split())
        else:
            keep.append(c)
            lift_hovers(c)
    n['children'] = keep


# The live demo's drawings: every state in every layout, from demo.txt.
STATES = ('calm', 'amber', 'cold', 'limit')
# The layout the page opens on, as its script's first state does.
FIRST = 'chips'


def demo_drawings(path, layouts):
    """{layout: {state: {shut, open}}}: each DEMO line's tree, its hover cards
    lifted onto their chips, drawn for the site. A countdown in the last
    minute is wrapped in <span class=cd>; departures draws its countdown on
    flap tiles inside an SVG, so its drawings carry none."""
    demo = {layout: {state: {} for state in STATES} for layout in layouts}
    with open(path) as f:
        for line in f:
            _, layout, state, look, js = line.rstrip('\n').split(' ', 4)
            tree = json.loads(js)
            lift_hovers(tree)
            demo[layout][state][look] = node(tree, site=True)
    for layout in layouts:
        for state in STATES:
            for look in ('shut', 'open'):
                body = demo[layout][state].get(look)
                assert body, f'no {layout} {state} {look} drawing in {path}'
                ticks = state == 'amber' and layout != 'departures'
                assert ('<span class=cd>' in body) == ticks, f'{layout} {state} {look}: countdown span {"missing" if ticks else "unexpected"}'
    return demo


def radio(layout):
    """A layout's radio button in the demo's layout switch."""
    checked = ' checked' if layout == FIRST else ''
    return f'<label><input type="radio" name="layout" value="{layout}"{checked}>{layout}</label>'


def with_radios(page, layouts):
    """`page` with each line holding {{layout-radio}} once per layout, in
    the capture's order, that layout's radio button in its place."""
    line = re.compile(r'^(.*)\{\{layout-radio\}\}(.*)$', flags=re.MULTILINE)
    return line.sub(lambda m: '\n'.join(m.group(1) + radio(k) + m.group(2) for k in layouts), page)


def in_words(names):
    """`a, b or c`."""
    return names[0] if len(names) == 1 else f'{", ".join(names[:-1])} or {names[-1]}'


def faq_json(page):
    """The page's fine print (each `<div class="q"><h3>…</h3><p>…</p></div>`)
    as a schema.org FAQPage, in plain text: tags dropped, entities decoded,
    the non-breaking hyphen a plain one."""
    def plain(fragment):
        return html.unescape(re.sub(r'<[^>]+>', '', fragment)).replace('\u2011', '-')
    blocks = re.findall(r'<div class="q"><h3>(.*?)</h3><p>(.*?)</p></div>', page, flags=re.DOTALL)
    assert blocks, 'no fine print to build the FAQ from'
    questions = [
        {'@type': 'Question', 'name': plain(q), 'acceptedAnswer': {'@type': 'Answer', 'text': plain(a)}}
        for q, a in blocks
    ]
    return script_json({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': questions})


def script_json(data):
    """JSON safe inside <script type="application/json">."""
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/').replace('<!--', '<\\u0021--')


src, template, out = sys.argv[1], sys.argv[2], sys.argv[3]
demo_src = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(src), 'demo.txt')

page = read(template)
# The release the page describes is the manifest's, and it is dated the day
# it was built (UTC), as the sitemap is: neither is typed into the template.
page = page.replace('{{version}}', plugin_version())
page = page.replace('{{faq-json}}', faq_json(page))
page = page.replace('{{built}}', datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'))
if '{{demo-' in page or '{{layout-' in page:
    layouts = demo_layouts(demo_src)
    assert FIRST in layouts, f'no {FIRST} drawing in {demo_src}, which the page opens on'
    page = with_radios(page, layouts)
    page = page.replace('{{layout-names}}', in_words(layouts))
    demo = demo_drawings(demo_src, layouts)
    page = page.replace('{{demo-chips-amber}}', demo[FIRST]['amber']['shut'])
    page = page.replace('{{demo-json}}', script_json(demo))
assert '{{' not in page, 'unfilled placeholder'
write(out, page)
print(len(page))
