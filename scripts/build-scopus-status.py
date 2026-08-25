#!/usr/bin/env python3
"""Build data/scopus-status.csv from Elsevier's official Scopus source list.

The SCImago export only carries a coverage range, so a journal Scopus dropped
for quality reasons ("Discontinued by Scopus") can still look covered
("2020-2025"). Elsevier publishes the authoritative list monthly as an xlsx
(ext_list_<Mon>_<Year>.xlsx, linked from the Scopus content page); this script
finds that link, downloads the file and writes a compact CSV of every source
that is NOT active, so the app can flag them.

Output columns (one row per non-active source, both ISSNs normalised):
  issn,eissn,status,year
  status = 'discontinued'  removed by Scopus (quality / publication concerns)
           'policy'        removed after a journal policy change
           'inactive'      coverage simply ended (ceased, renamed, merged...)
  year   = final coverage year (from the discontinued sheet, else the
           last year of the coverage column)

Usage: python3 scripts/build-scopus-status.py [ext_list.xlsx] [out.csv]
       (with no xlsx argument the file is downloaded)
Standard library only.
"""
import csv, io, os, re, sys, urllib.request, zipfile
from xml.etree import ElementTree as ET

PAGE = 'https://www.elsevier.com/products/scopus/content'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (openaccessfinder.de data refresh)'}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()


def find_xlsx_url():
    html = fetch(PAGE).decode('utf-8', 'replace')
    m = re.search(r'(//[^"\'\s]+/ext_list_[A-Za-z]+_\d{4}\.xlsx)', html)
    if not m:
        sys.exit('could not find the ext_list xlsx link on ' + PAGE)
    return 'https:' + m.group(1)


def load(path_or_bytes):
    z = zipfile.ZipFile(path_or_bytes if isinstance(path_or_bytes, str) else io.BytesIO(path_or_bytes))
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid = {r.get('Id'): r.get('Target') for r in rels}
    RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    sheets = {s.get('name'): rid[s.get(RNS)] for s in wb.iter('{%s}sheet' % NS['m'])}
    return z, ss, sheets


def rows(z, ss, target):
    path = 'xl/' + target.lstrip('/').replace('xl/', '')
    out = []
    for _, el in ET.iterparse(z.open(path)):
        if el.tag == '{%s}row' % NS['m']:
            r = {}
            for c in el.findall('m:c', NS):
                col = re.match(r'([A-Z]+)', c.get('r')).group(1)
                v = c.find('m:v', NS)
                if v is None:
                    isel = c.find('m:is', NS)
                    val = ''.join(x.text or '' for x in isel.iter('{%s}t' % NS['m'])) if isel is not None else ''
                else:
                    val = ss[int(v.text)] if c.get('t') == 's' else v.text
                r[col] = (val or '').strip()
            out.append(r)
            el.clear()
    return out


def norm_issn(s):
    s = re.sub(r'[^0-9Xx]', '', s or '').upper()
    return s.zfill(8) if 0 < len(s) <= 8 else ''


def main():
    src = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('.xlsx') else None
    out = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].endswith('.csv') else os.path.join(ROOT, 'data', 'scopus-status.csv')
    if src:
        z, ss, sheets = load(src)
    else:
        url = find_xlsx_url()
        print('downloading', url)
        z, ss, sheets = load(fetch(url))
    name_src = next(n for n in sheets if n.lower().startswith('scopus sources'))
    name_disc = next(n for n in sheets if n.lower().startswith('discontinued'))
    print('sheets:', name_src, '|', name_disc)

    srows = rows(z, ss, sheets[name_src])
    hdr = {v.strip().lower(): k for k, v in srows[0].items()}
    col = lambda r, name: r.get(hdr[name], '')
    for need in ('issn', 'eissn', 'active or inactive', 'coverage', 'titles discontinued by scopus', 'source title'):
        if need not in hdr:
            sys.exit('missing column: ' + need)

    drows = rows(z, ss, sheets[name_disc])
    dh = next(i for i, r in enumerate(drows) if 'Sourcerecord ID' in r.values())
    dhdr = {v.strip().lower(): k for k, v in drows[dh].items()}
    disc = {}
    for r in drows[dh + 1:]:
        sid = r.get(dhdr['sourcerecord id'], '')
        if sid:
            disc[sid] = (r.get(dhdr['indexation change'], ''), r.get(dhdr['year'], ''))

    n_active = n_out = 0
    lines = []
    for r in srows[1:]:
        if not r.get('A'):
            continue
        if col(r, 'active or inactive').lower() == 'active' and not col(r, 'titles discontinued by scopus'):
            n_active += 1
            continue
        sid = r.get('A', '')
        change, year = disc.get(sid, ('', ''))
        if col(r, 'titles discontinued by scopus') or change == 'Discontinuation':
            status = 'discontinued'
        elif change:
            status = 'policy'
        else:
            status = 'inactive'
        if not re.fullmatch(r'\d{4}', year or ''):
            yrs = re.findall(r'\d{4}', col(r, 'coverage'))
            year = max(yrs) if yrs else ''
        issn, eissn = norm_issn(col(r, 'issn')), norm_issn(col(r, 'eissn'))
        if not issn and not eissn:
            continue
        lines.append([issn, eissn, status, year])
        n_out += 1
    if n_out < 5000 or n_active < 20000:
        sys.exit('list looks incomplete (active=%d, non-active=%d); not writing' % (n_active, n_out))
    lines.sort()
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['issn', 'eissn', 'status', 'year'])
        w.writerows(lines)
    from collections import Counter
    print('wrote', out, '-', n_out, 'non-active sources;', n_active, 'active;', dict(Counter(l[2] for l in lines)))


if __name__ == '__main__':
    main()
