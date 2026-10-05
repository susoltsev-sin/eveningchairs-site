#!/usr/bin/env python3
"""Tells IndexNow (Bing, Yandex and the other participants) which pages changed in this push.

Changed = HTML files touched between $BEFORE and $AFTER whose URL is in sitemap.xml.
No usable $BEFORE (manual run, first push, force-push) -> every URL from sitemap.xml.
Never fails the deploy: a bad answer only prints a warning.

Usage: BEFORE=<sha> AFTER=<sha> python3 tools/indexnow.py   (DRY_RUN=1 to only print the list)
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

BASE = 'https://eveningchairs.com'
KEY = '39e5f19b1c4536c4c712fdb6aa6ecab5'   # must match the <KEY>.txt file in the site root
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, 'sitemap.xml'), encoding='utf-8') as fh:
    all_urls = re.findall(r'<loc>([^<]+)</loc>', fh.read())

urls = all_urls
before, after = os.environ.get('BEFORE', ''), os.environ.get('AFTER', 'HEAD')
if before and set(before) != {'0'}:
    try:
        files = subprocess.run(['git', 'diff', '--name-only', before, after], cwd=ROOT,
                               capture_output=True, text=True, check=True).stdout.split()
        changed = {BASE + '/' + (f[:-len('index.html')] if f.endswith('index.html') else f)
                   for f in files if f.endswith('.html')}
        urls = [u for u in all_urls if u in changed]
    except subprocess.CalledProcessError:
        pass  # unknown BEFORE (force-push etc.) -> send everything

if os.environ.get('DRY_RUN'):
    print('IndexNow (dry run) would send:', *urls, sep='\n  ')
    sys.exit(0)

if not urls:
    print('IndexNow: no page content changed in this push, nothing to send')
    sys.exit(0)

body = json.dumps({'host': 'eveningchairs.com', 'key': KEY,
                   'keyLocation': f'{BASE}/{KEY}.txt', 'urlList': urls}).encode()
req = urllib.request.Request('https://api.indexnow.org/indexnow', data=body,
                             headers={'Content-Type': 'application/json; charset=utf-8'})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f'IndexNow: {r.status}', *urls, sep='\n  ')
except urllib.error.HTTPError as e:
    print(f'::warning::IndexNow answered {e.code} (403 = key file not live yet, 422 = URL/host mismatch)')
except urllib.error.URLError as e:
    print(f'::warning::IndexNow unreachable: {e.reason}')
