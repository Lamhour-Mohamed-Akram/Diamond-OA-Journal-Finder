#!/usr/bin/env python3
"""Rebuild data/scimago.csv from the sjrdata mirror.

scimagojr.com blocks scripted downloads (Cloudflare), so the refresh
workflow pulls the latest yearly journal export from the community mirror
github.com/ikashnitsky/sjrdata (MIT; repackages the official scimagojr.com
CSVs as parquet) and converts it back to the exact CSV shape the official
"Download" button produces — semicolon-delimited, comma-decimal numbers —
which is what js/data.js parses.

Usage: scimago_from_sjrdata.py <sjr_journals.parquet> <out.csv>
Requires: duckdb (pip install duckdb)
"""
import csv
import sys

import duckdb

MIN_ROWS = 25_000  # a full yearly export has ~32k sources


def dec(v, nd):
    """Format a float the way scimagojr.com exports do: comma as decimal mark."""
    return '' if v is None else f'{v:.{nd}f}'.replace('.', ',')


def integer(v):
    return '' if v is None else str(int(v))


def text(v):
    return '' if v is None else str(v)


def main(src, out):
    con = duckdb.connect()
    year = con.execute(f"SELECT max(year) FROM '{src}'").fetchone()[0]
    cur = con.execute(
        f"""SELECT rank, sourceid, title, type, issn, publisher, open_access,
                   open_access_diamond, sjr, sjr_best_quartile, h_index,
                   total_docs_year, total_docs_3years, total_refs,
                   total_citations_3years, citable_docs_3years,
                   citations_doc_2years, ref_doc, percent_female, overton,
                   country, region, coverage, categories, areas
            FROM '{src}' WHERE year = {year} ORDER BY rank"""
    )
    rows = cur.fetchall()
    if len(rows) < MIN_ROWS:
        sys.exit(f'only {len(rows)} rows for year {year:g} — refusing to write')

    header = ['Rank', 'Sourceid', 'Title', 'Type', 'Issn', 'Publisher',
              'Open Access', 'Open Access Diamond', 'SJR', 'SJR Best Quartile',
              'H index', f'Total Docs. ({year:g})', 'Total Docs. (3years)',
              'Total Refs.', 'Total Citations (3years)', 'Citable Docs. (3years)',
              'Citations / Doc. (2years)', 'Ref. / Doc.', '%Female', 'Overton',
              'Country', 'Region', 'Publisher', 'Coverage', 'Categories', 'Areas']

    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';', lineterminator='\n')
        w.writerow(header)
        for (rank, sourceid, title, typ, issn, publisher, oa, oad, sjr, quart,
             h, docs_y, docs_3y, refs, cits_3y, citable_3y, cpd_2y, rpd,
             female, overton, country, region, coverage, cats, areas) in rows:
            w.writerow([
                integer(rank), integer(sourceid), text(title), text(typ),
                text(issn), text(publisher), text(oa), text(oad),
                dec(sjr, 3), text(quart) or '-', integer(h),
                integer(docs_y), integer(docs_3y), integer(refs),
                integer(cits_3y), integer(citable_3y),
                dec(cpd_2y, 2), dec(rpd, 2), dec(female, 2), integer(overton),
                text(country), text(region), text(publisher),
                text(coverage), text(cats), text(areas),
            ])
    print(f'wrote {len(rows)} sources (SJR year {year:g}) to {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
