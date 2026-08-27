#!/usr/bin/env python3
"""Automatically maintain data/extra-journals.csv from OJS hosts (default: the
IMIST/CNRST platforms revues.imist.ma + journals.imist.ma, which host most
Moroccan academic journals). Runs weekly in GitHub Actions
(.github/workflows/extra-journals.yml); no manual step needed.

For every journal on the host that DOAJ does not list (by ISSN), the script
runs these automatic checks and adds the journal only if ALL pass:
  1. ISSN found (MARC field 022 via OAI-PMH, or on the journal pages; checksum-validated)
  2. a peer-review / editorial-policy statement on the site
  3. no author-fee wording (or an explicit "free / gratuit / مجانية" statement)
  4. at least one article published in the last 2 years (OAI-PMH `from=`)
Rows it writes carry Source = "<host>-auto"; the ⓘ popup on the site says
they were checked automatically. Rows with any other Source (added by hand)
are kept untouched. Journals that fail a check are only logged.

    python3 scripts/build-extra-journals.py                       # default hosts
    python3 scripts/build-extra-journals.py https://ojs.example.org --country=Spain
    python3 scripts/build-extra-journals.py --workers=24      # parallel requests (default 16)
    python3 scripts/build-extra-journals.py --fresh           # ignore the 30-day result cache

Results are cached per journal in data/extra-journals.cache.json for 30 days
(--max-age=N), so the weekly run only re-checks journals whose result is
older than that - typically a handful of requests.
"""
import csv, html, io, os, re, sys, time, datetime, urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET

DEFAULT_HOSTS = ['https://revues.imist.ma', 'https://journals.imist.ma']
CSV_PATH = 'data/extra-journals.csv'
DOAJ_PATH = 'data/doaj.csv'
COLS = ['Journal title','Journal URL','ISSN (print)','EISSN','Publisher','Country','Languages','Review process',
        'Subjects','Keywords','APC','Has other fees','APC amount','Weeks to publication','Source','Verified on','Notes','Evidence URL']
UA = {'User-Agent': 'Mozilla/5.0 (openaccessfinder.de extra-journals bot)'}
OAI = '{http://www.openarchives.org/OAI/2.0/}'
DC  = '{http://purl.org/dc/elements/1.1/}'
TODAY = datetime.date.today()
SINCE = (TODAY - datetime.timedelta(days=730)).isoformat()

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) if '=' in a else (a[2:], True) for a in sys.argv[1:] if a.startswith('--'))
HOSTS = [h.rstrip('/') for h in args] or DEFAULT_HOSTS
COUNTRY = opts.get('country') or ('Morocco' if all('imist.ma' in h for h in HOSTS) else '')

def log(*a): print(*a, file=sys.stderr, flush=True)

def get(url, timeout=45, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404: raise
            last = e
        except Exception as e:
            last = e
        time.sleep(2)
    raise last

def norm(issn):
    s = re.sub(r'[^0-9Xx]', '', issn or '').upper()
    return s if len(s) == 8 else None
def fmt(n): return n[:4] + '-' + n[4:] if n else ''
def text_of(page):
    page = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', page, flags=re.S | re.I)
    return html.unescape(re.sub(r'<[^>]+>', ' ', page))

ISSN_RE   = re.compile(r'ISSN[^0-9]{0,25}(\d{4}\s?-?\s?\d{3}[\dXx])', re.I)
REVIEW_RE = re.compile(r'peer[- ]?review|double[- ]blind|single[- ]blind|évaluation par les pairs|evaluation par les pairs|comité de lecture|comite de lecture|arbitrage|relecture|reviewers?|évaluateurs|تحكيم|محكم|المحكمين', re.I)
FEE_RE    = re.compile(r'\b(APC|article processing|publication fee|processing fee|submission fee|author fee|frais de (publication|soumission|traitement)|frais d.auteur|رسوم)\b', re.I)
FREE_RE   = re.compile(r'no (article processing|publication|submission|author) (charge|fee)|free of charge|no APC|without (any )?fee|gratuit|aucun frais|sans frais|مجان', re.I)
LANG = {'fr':'French','fra':'French','fre':'French','en':'English','eng':'English','ar':'Arabic','ara':'Arabic','es':'Spanish','spa':'Spanish','de':'German','it':'Italian','pt':'Portuguese'}

# ---- DOAJ ISSNs ----
have = set()
with open(DOAJ_PATH, encoding='utf-8') as f:
    for row in csv.DictReader(f):
        for k in ('Journal ISSN (print version)', 'Journal EISSN (online version)'):
            n = norm(row.get(k))
            if n: have.add(n)
log(f'DOAJ ISSNs loaded: {len(have)}')

# ---- existing CSV: keep hand-added rows ----
manual = []
if os.path.exists(CSV_PATH):
    with open(CSV_PATH, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            if row.get('Journal title') and not (row.get('Source') or '').endswith('-auto'):
                manual.append({c: row.get(c, '') for c in COLS})
log(f'hand-added rows kept: {len(manual)}')
manual_issns = {norm(r[k]) for r in manual for k in ('ISSN (print)', 'EISSN') if norm(r[k])}

def oai(host, query):
    root = ET.fromstring(get(f'{host}/index.php/index/oai?{query}'))
    err = root.find(OAI + 'error')
    return root, (err.get('code') if err is not None else None)

def journals_on(host):
    out, token = [], None
    while True:
        q = 'verb=ListSets' + (f'&resumptionToken={urllib.parse.quote(token)}' if token else '')
        root, err = oai(host, q)
        if err: break
        for s in root.iter(OAI + 'set'):
            spec, name = s.findtext(OAI + 'setSpec') or '', (s.findtext(OAI + 'setName') or '').strip()
            if spec and ':' not in spec: out.append((spec, name))
        tok = root.find(f'.//{OAI}resumptionToken')
        token = tok.text.strip() if tok is not None and tok.text else None
        if not token: break
    return out

def valid_issn(n):
    """ISSN check digit (mod 11) - kills random 8-digit numbers picked up by the regex."""
    if not n or len(n) != 8: return False
    tot = sum((8 - i) * int(ch) for i, ch in enumerate(n[:7]))
    chk = (11 - tot % 11) % 11
    return n[7] == ('X' if chk == 10 else str(chk))

MARC = '{http://www.loc.gov/MARC21/slim}'
def check(host, spec, name):
    """2-3 requests per journal, cheapest first, early exit:
       1. OAI ListIdentifiers since 2 years ago -> recency (+ one article id)
       2. journal /about page                   -> ISSN, review / fee wording
       3. OAI GetRecord marcxml (only if the page shows no ISSN) -> ISSN 022, language 041"""
    base = f'{host}/index.php/{spec}'
    root, err = oai(host, f'verb=ListIdentifiers&metadataPrefix=oai_dc&set={urllib.parse.quote(spec)}&from={SINCE}')
    ident = root.find(f'.//{OAI}identifier') if not err else None
    if ident is None or not ident.text:
        return 'no article in last 2 years', None
    try: txt = text_of(get(base + '/about', timeout=45, tries=2))
    except Exception: txt = ''
    if not REVIEW_RE.search(txt):      return 'no peer-review statement', None
    if FEE_RE.search(txt) and not FREE_RE.search(txt): return 'fee wording found', None
    issns = {norm(m) for m in ISSN_RE.findall(txt) if valid_issn(norm(m))}
    langs = set()
    if not issns:
        try:
            rec, err = oai(host, f'verb=GetRecord&metadataPrefix=marcxml&identifier={urllib.parse.quote(ident.text.strip())}')
            if not err:
                for df in rec.iter(MARC + 'datafield'):
                    if df.get('tag') == '022':
                        for sf in df:
                            n = norm(sf.text)
                            if valid_issn(n): issns.add(n)
                    elif df.get('tag') == '041':
                        for sf in df:
                            code = (sf.text or '').strip().lower()[:3]
                            if code in LANG: langs.add(LANG[code])
        except Exception: pass
    issns = sorted(issns)
    if any(i in have for i in issns):  return 'in DOAJ', None
    if any(i in manual_issns for i in issns): return 'added by hand', None
    if not issns:                      return 'no ISSN', None
    hostname = urllib.parse.urlparse(host).hostname
    row = {c: '' for c in COLS}
    row.update({
        'Journal title': name or spec, 'Journal URL': base,
        'ISSN (print)': fmt(issns[0]), 'EISSN': fmt(issns[1]) if len(issns) > 1 else '',
        'Publisher': f'hosted on {hostname}' + (' (IMIST / CNRST)' if 'imist.ma' in hostname else ''),
        'Country': COUNTRY, 'Languages': ', '.join(sorted(langs)),
        'Review process': 'Peer review (policy stated on the journal site)',
        'APC': 'No', 'Has other fees': 'No', 'Source': f'{hostname}-auto', 'Verified on': TODAY.isoformat(),
        'Notes': 'Automatic checks passed: ISSN found · peer-review statement · no fee wording · articles in the last 2 years.',
        'Evidence URL': base + '/about',
    })
    return 'ADDED', row

WORKERS = int(opts.get('workers', 16))
CACHE_PATH = 'data/extra-journals.cache.json'   # per-journal results; re-checked after MAX_AGE days
MAX_AGE = int(opts.get('max-age', 30))
import json
from concurrent.futures import ThreadPoolExecutor
cache = {}
if os.path.exists(CACHE_PATH) and not opts.get('fresh'):
    try: cache = json.load(open(CACHE_PATH, encoding='utf-8'))
    except Exception: cache = {}
def fresh_enough(entry):
    try: return (TODAY - datetime.date.fromisoformat(entry['date'])).days < MAX_AGE
    except Exception: return False

auto, stats = [], {}
for host in HOSTS:
    try: js = journals_on(host)
    except Exception as e:
        log(f'::warning::{host} unreachable ({e}) - skipping this host'); continue
    todo = [(spec, name) for spec, name in js if not fresh_enough(cache.get(f'{host}/{spec}', {}))]
    log(f'{host}: {len(js)} journals, {len(js) - len(todo)} cached (<{MAX_AGE} days), {len(todo)} to check with {WORKERS} workers')
    def run(item):
        spec, name = item
        try: return spec, name, *check(host, spec, name)
        except Exception as e: return spec, name, f'error {e}', None
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for spec, name, status, row in ex.map(run, todo):
            if not status.startswith('error'):    # transient errors are retried next run
                cache[f'{host}/{spec}'] = {'date': TODAY.isoformat(), 'status': status, 'row': row}
            log(f'  {status:28} {spec:22} {name[:55]}')
    for spec, name in js:
        e = cache.get(f'{host}/{spec}')
        if not e: continue
        stats[e['status']] = stats.get(e['status'], 0) + 1
        if e['row']:
            row = dict(e['row'])
            # a cached "ADDED" journal that DOAJ has listed since is dropped
            if any(norm(row[k]) in have for k in ('ISSN (print)', 'EISSN') if norm(row[k])): continue
            auto.append(row)

if stats:
    with open(CACHE_PATH, 'w', encoding='utf-8') as f: json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)
if not stats:
    log('::warning::no host reachable - leaving the CSV untouched'); sys.exit(0)
log('summary: ' + ', '.join(f'{k}={v}' for k, v in sorted(stats.items())))
rows = manual + sorted(auto, key=lambda r: r['Journal title'].lower())
with open(CSV_PATH, 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, fieldnames=COLS, lineterminator='\n'); w.writeheader(); w.writerows(rows)
log(f'{CSV_PATH}: {len(manual)} hand-added + {len(auto)} auto-checked rows written')
