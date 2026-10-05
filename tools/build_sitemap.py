#!/usr/bin/env python3
"""Builds sitemap.xml from the site's own HTML pages, so nobody has to edit it by hand.

A page gets listed when
  * its <link rel="canonical"> points to the page itself, and
  * it has no <meta name="robots" content="noindex">.
That automatically skips the root language router (canonical -> /en/), ru.html (old redirect)
and 404.html (noindex). Language alternates are copied from the page's own
<link rel="alternate" hreflang="..."> tags; lastmod is the date of the last git commit
that touched the file.

Usage (from the repo root):  python3 tools/build_sitemap.py [output-path]
"""
import datetime
import os
import subprocess
import sys
from html.parser import HTMLParser

BASE = 'https://eveningchairs.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'.git', '.github', 'tools', '_site', 'node_modules'}


class Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonical, self.noindex, self.alternates, self.done = None, False, [], False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        a = dict(attrs)
        rel = (a.get('rel') or '').lower()
        if tag == 'link' and rel == 'canonical':
            self.canonical = a.get('href')
        elif tag == 'link' and rel == 'alternate' and a.get('hreflang'):
            self.alternates.append((a['hreflang'], a.get('href')))
        elif tag == 'meta' and (a.get('name') or '').lower() == 'robots' and 'noindex' in (a.get('content') or '').lower():
            self.noindex = True
        elif tag == 'body':
            self.done = True


def url_for(rel):
    """'en/b2ai/index.html' -> 'https://eveningchairs.com/en/b2ai/'"""
    return BASE + '/' + (rel[:-len('index.html')] if rel.endswith('index.html') else rel)


def lastmod(rel):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    try:
        out = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', rel], cwd=ROOT,
                             capture_output=True, text=True, env=env).stdout.strip()
        if out:
            return out
    except OSError:
        pass
    return datetime.date.fromtimestamp(os.path.getmtime(os.path.join(ROOT, rel))).isoformat()


def collect():
    entries = []
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            if not f.endswith('.html'):
                continue
            rel = os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, '/')
            h = Head()
            with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
                h.feed(fh.read())
            if h.noindex or h.canonical != url_for(rel):
                continue
            entries.append((h.canonical, lastmod(rel), h.alternates))
    # shallow pages first (/en/, /ru/), then by path
    entries.sort(key=lambda e: (e[0].count('/'), e[0]))
    return entries


def render(entries):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for loc, mod, alts in entries:
        out += ['  <url>', f'    <loc>{loc}</loc>', f'    <lastmod>{mod}</lastmod>']
        out += [f'    <xhtml:link rel="alternate" hreflang="{hl}" href="{href}"/>' for hl, href in alts]
        out.append('  </url>')
    out.append('</urlset>')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'sitemap.xml')
    entries = collect()
    with open(target, 'w', encoding='utf-8') as fh:
        fh.write(render(entries))
    for loc, mod, _ in entries:
        print(f'{mod}  {loc}')
