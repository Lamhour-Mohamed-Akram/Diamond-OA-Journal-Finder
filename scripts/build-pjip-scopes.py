#!/usr/bin/env python3
"""Builds data/pjip-scopes.json, the Aims & Scope text shown on journal cards, from a PJIP data export.

    python3 scripts/build-pjip-scopes.py <pjip export .csv> [data/pjip-scopes.json]

PJIP (https://www.pjip.org) shares its journal data under CC BY-NC 4.0. The site may therefore display the
text verbatim, with attribution and a link from every journal to its PJIP profile page (both required by
PJIP; see README "Data sources"). Only journals present in the site's own catalog (data/doaj.csv +
data/extra-journals.csv, matched by ISSN) are kept, so the file never carries journals the site cannot show.

The export's columns (2026): pjip_id, eissn, all_issns (JSON list), journal_name, journal_homepage, aims_scope,
pjip_url. Extra columns in a future export are ignored; missing text or URL drops the row.

Output shape (every 8-digit ISSN of a journal points at the same entry, stored once):
  {"_meta": {...}, "j": [{"t": "<aims & scope>", "u": "<pjip profile url>"}, ...], "issns": {"12345678": <index into j>}}
"""
import csv, datetime, json, re, sys, os

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
issn8 = lambda s: re.sub(r"[\s-]", "", s or "").upper()

def catalog_issns(doaj="data/doaj.csv", extra="data/extra-journals.csv"):
    ids = set()
    for path, cols in ((doaj, ("Journal ISSN (print version)", "Journal EISSN (online version)")), (extra, ("issn", "eissn"))):
        if not os.path.exists(path): continue
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                for c in cols:
                    v = issn8(r.get(c))
                    if len(v) == 8: ids.add(v)
    return ids

def main(src, out="data/pjip-scopes.json"):
    known = catalog_issns(); entries = {}; journals = []; n = 0; skipped = {"not_in_catalog": 0, "no_text_or_url": 0}
    with open(src, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            text = re.sub(r"\s+", " ", (r.get("aims_scope") or "")).strip(); url = (r.get("pjip_url") or "").strip()
            if len(text) < 40 or not url.startswith("http"): skipped["no_text_or_url"] += 1; continue
            try: ids = {issn8(x) for x in json.loads(r.get("all_issns") or "[]")}
            except (TypeError, ValueError): ids = set()
            ids.add(issn8(r.get("eissn"))); ids = {i for i in ids if len(i) == 8}
            if not ids & known: skipped["not_in_catalog"] += 1; continue
            journals.append({"t": text, "u": url}); n += 1
            for i in ids: entries[i] = len(journals) - 1
    doc = {"_meta": {"source": "PJIP", "url": "https://www.pjip.org", "licence": "CC BY-NC 4.0", "attribution": "Aims & scope text by PJIP (pjip.org), CC BY-NC 4.0",
                     "built": datetime.date.today().isoformat(), "journals": n, "input": os.path.basename(src)}, "j": journals, "issns": entries}
    with open(out, "w", encoding="utf-8") as g: json.dump(doc, g, ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: {n} journals, {len(entries)} ISSN keys, {os.path.getsize(out)/1048576:.2f} MB; skipped {skipped}")

if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    main(*sys.argv[1:3])
