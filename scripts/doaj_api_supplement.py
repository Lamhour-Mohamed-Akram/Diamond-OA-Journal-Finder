#!/usr/bin/env python3
"""Top up data/doaj.csv with journals DOAJ added after the CSV export was cut.

doaj.org/csv lags DOAJ's live database by several weeks (the export is
regenerated infrequently), so a snapshot downloaded today can miss a month of
newly indexed journals. This script asks the DOAJ search API for every journal
whose created_date is later than the newest "Added on Date" already in the
CSV, converts each record into the same 52 columns as the export, and appends
the rows. Journals already present (by ISSN) are skipped.

Usage:  python3 scripts/doaj_api_supplement.py [data/doaj.csv]
Requires: pycountry (ISO country / language names, same vocabulary as the CSV)

Fails loudly (non-zero exit, CSV untouched) if the API cannot be reached or
returns something unexpected, so a bad run never corrupts good data.
"""
import csv, json, sys, time, urllib.parse, urllib.request
from pathlib import Path

try:
    import pycountry
except ImportError:
    sys.exit('pycountry is required:  pip install pycountry')

CSV_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else 'data/doaj.csv')
API = 'https://doaj.org/api/search/journals/'
PAGE = 100
MAX_NEW = 5000            # sanity cap — DOAJ adds a few hundred journals a month

# pycountry gaps for codes DOAJ actually uses
COUNTRY_FIX = {'XK': 'Kosovo'}


def country_name(code):
    if not code:
        return ''
    c = pycountry.countries.get(alpha_2=code.upper())
    return c.name if c else COUNTRY_FIX.get(code.upper(), code)


def language_name(code):
    if not code:
        return ''
    code = code.lower()
    lang = pycountry.languages.get(alpha_2=code) if len(code) == 2 else pycountry.languages.get(alpha_3=code)
    return lang.name if lang else code


def yes_no(v):
    return '' if v is None else ('Yes' if v else 'No')


def join(items, sep=', '):
    return sep.join(x for x in (items or []) if x)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'diamond-oa-journal-finder (data refresh)'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:                      # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def api_rows(since):
    """All journals with created_date > since (ISO string), newest first."""
    q = urllib.parse.quote(f'created_date:[{since} TO 2100-01-01]', safe='')   # the API rejects an open-ended '*' bound
    url = f'{API}{q}?pageSize={PAGE}&sort=created_date:asc'
    out = []
    while url:
        d = fetch(url)
        if 'results' not in d:
            raise RuntimeError(f'unexpected API response: {str(d)[:200]}')
        if d.get('total', 0) > MAX_NEW:
            raise RuntimeError(f'API reports {d["total"]} new journals — more than {MAX_NEW}, refusing')
        out.extend(d['results'])
        url = d.get('next')
    return out


def to_row(rec, header, subject_by_code):
    b = rec.get('bibjson', {})
    g = lambda *ks: _dig(b, ks)   # noqa: E731
    lic = b.get('license') or [{}]
    codes = [s.get('code', '') for s in b.get('subject', []) if s.get('scheme') == 'LCC']
    subjects = [subject_by_code.get(s.get('code'), s.get('term', '')) for s in b.get('subject', []) if s.get('scheme') == 'LCC']
    apc_max = b.get('apc', {}).get('max') or []
    row = {
        'Journal title': b.get('title', ''),
        'Journal URL': g('ref', 'journal'),
        'URL in DOAJ': f"https://doaj.org/toc/{rec.get('id', '')}",
        'When did the journal start to publish all content using an open license?': b.get('oa_start', ''),
        'Alternative title': b.get('alternative_title', ''),
        'Journal ISSN (print version)': b.get('pissn', ''),
        'Journal EISSN (online version)': b.get('eissn', ''),
        'Keywords': join(b.get('keywords')),
        'Languages in which the journal accepts manuscripts': join(language_name(c) for c in b.get('language', [])),
        'Publisher': g('publisher', 'name'),
        'Country of publisher': country_name(g('publisher', 'country')),
        'Other organisation': g('institution', 'name'),
        'Country of other organisation': country_name(g('institution', 'country')),
        'Journal license': join(l.get('type') for l in lic),
        'License attributes': '',
        'URL for license terms': g('ref', 'license_terms'),
        'Machine-readable CC licensing information embedded or displayed in articles':
            'Yes' if 'Embed' in (g('article', 'license_display') or []) else '',
        'Author holds copyright without restrictions': yes_no(g('copyright', 'author_retains')),
        'Copyright information URL': g('copyright', 'url'),
        'Review process': join(g('editorial', 'review_process')),
        'Review process information URL': g('editorial', 'review_url'),
        'Journal plagiarism screening policy': yes_no(g('plagiarism', 'detection')),
        "URL for journal's aims & scope": g('ref', 'aims_scope'),
        'URL for the Editorial Board page': g('editorial', 'board_url'),
        "URL for journal's instructions for authors": g('ref', 'author_instructions'),
        'Average number of weeks between article submission and publication': b.get('publication_time_weeks', ''),
        'APC': yes_no(g('apc', 'has_apc')),
        'APC information URL': g('apc', 'url'),
        'APC amount': '; '.join(f"{m.get('price', '')} {m.get('currency', '')}".strip() for m in apc_max),
        'Journal waiver policy (for developing country authors etc)': yes_no(g('waiver', 'has_waiver')),
        'Waiver policy information URL': g('waiver', 'url'),
        'Has other fees': yes_no(g('other_charges', 'has_other_charges')),
        'Other fees information URL': g('other_charges', 'url'),
        'Preservation Services': join(g('preservation', 'service')),
        'Preservation Service: national library': join(g('preservation', 'national_library')),
        'Preservation information URL': g('preservation', 'url'),
        'Deposit policy directory': join(g('deposit_policy', 'service')),
        'URL for deposit policy': g('deposit_policy', 'url'),
        'Persistent article identifiers': join(g('pid_scheme', 'scheme')),
        "Does the journal comply to DOAJ's definition of open access?": yes_no(b.get('boai')),
        'Continues': join(b.get('continues')),
        'Continued By': join(b.get('continued_by')),
        'LCC Codes': join(codes, '|'),
        'Subscribe to Open': yes_no(b.get('subscribe_to_open', False)),
        'Mirror Journal': yes_no(b.get('is_mirror', False)),
        'Open Journals Collective': yes_no(b.get('open_journals_collective', False)),
        'Subjects': join(subjects, ' | '),
        'Added on Date': rec.get('created_date', ''),
        'Last updated Date': rec.get('last_updated', ''),
        'Last Full Review Date': '',
        'Number of Article Records': '',
        'Most Recent Article Added': '',
    }
    return [str(row.get(h, '') if row.get(h, '') is not None else '') for h in header]


def _dig(d, keys):
    for k in keys:
        d = d.get(k) if isinstance(d, dict) else None
        if d is None:
            return ''
    return d


def main():
    with CSV_PATH.open(newline='', encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    idx = {h.strip(): i for i, h in enumerate(header)}
    for c in ('Added on Date', 'Journal ISSN (print version)', 'Journal EISSN (online version)', 'LCC Codes', 'Subjects'):
        if c not in idx:
            sys.exit(f'{CSV_PATH}: missing column "{c}"')

    since = max(r[idx['Added on Date']] for r in body if len(r) > idx['Added on Date'])
    known = {r[i] for r in body for i in (idx['Journal ISSN (print version)'], idx['Journal EISSN (online version)']) if len(r) > i and r[i]}

    # LCC code -> the export's "Top: Sub: Leaf" subject string, learnt from the CSV itself
    subject_by_code = {}
    for r in body:
        codes, subs = r[idx['LCC Codes']].split('|'), r[idx['Subjects']].split(' | ')
        if len(codes) == len(subs):
            subject_by_code.update(zip(codes, subs))

    print(f'CSV has {len(body):,} journals, newest added {since}; asking DOAJ API for later ones …')
    recs = api_rows(since)
    added = [to_row(r, header, subject_by_code) for r in recs
             if not ({r['bibjson'].get('pissn'), r['bibjson'].get('eissn')} - {None, ''}) & known]
    print(f'API returned {len(recs)} journals, {len(added)} not yet in the CSV')
    if not added:
        return
    with CSV_PATH.open('a', newline='', encoding='utf-8') as f:
        csv.writer(f).writerows(added)
    print(f'Appended {len(added)} rows to {CSV_PATH} (now {len(body) + len(added):,} journals)')


if __name__ == '__main__':
    main()
