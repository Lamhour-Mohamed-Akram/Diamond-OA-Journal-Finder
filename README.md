# Diamond OA Journal & Conference Finder

A **single-file web app** for researchers deciding where to publish:

- **Journals tab** — find **Diamond Open Access** journals (free to publish *and* free to read: no APC, no hidden fees), cross-referenced with **SCImago** rankings (quartile, SJR, H-index) and DOAJ metadata (turnaround time, peer-review type, country, languages, subjects).
- **Conferences tab** — browse **ranked computer-science conferences** (CCF + CORE ranks) with live upcoming **submission deadlines**, dates, locations, and links.

Everything runs **entirely in your browser**. No server, no account, nothing is uploaded anywhere. Loaded data is cached locally (IndexedDB) so the app opens instantly next time.

## Quick start

1. Download `Diamond_OA_Journal_Finder_Live.html` and open it in any modern browser.
2. Load journal data, either way:
   - **Live fetch** — click *"Fetch journals live from the DOAJ API"* (~14,000 Diamond OA journals, takes 1–2 minutes), or
   - **CSV drop** — drop the DOAJ journal CSV from [doaj.org/csv](https://doaj.org/csv).
3. Drop the SCImago rank CSV from [scimagojr.com/journalrank.php](https://www.scimagojr.com/journalrank.php) (*"Download data"* button) — needed for quartiles/SJR either way.
4. The app joins both sources on ISSN and remembers the result.

The **Conferences** tab needs no files at all — it fetches the open [ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) feed live (cached for 24 h). There is also a *"Just looking for conferences?"* shortcut on the start screen.

## Features

**Journals**
- Filter by SJR quartile (Q1–Q4 / unranked), subject area, country, max weeks to publication, SCImago-indexed only
- Full-text search across title, publisher, subjects, and country
- Sort by quartile, SJR, H-index, turnaround, or title
- Direct links to each journal's website and DOAJ record

**Conferences**
- 350+ CCF-listed CS conferences with CCF rank (A/B/C) and CORE rank (A*–C)
- Next abstract/submission deadline with days-left countdown
- Filter by rank, field (AI, Security, Databases, …), open calls only; search by acronym, name, or place
- Sort by soonest deadline, CCF rank, CORE rank, or A–Z
- Links to each conference website and dblp

## How it works

- **Diamond OA definition:** journals in DOAJ with `APC = No` **and** `Has other fees = No`.
- **Join:** DOAJ records are matched to SCImago rows by normalized print/electronic ISSN.
- **DOAJ live fetch:** DOAJ's search API caps every query at 1,000 accessible records, so the app cursor-paginates — sorted by `created_date`, advancing a date-range filter window by window — while respecting the 2 requests/second rate limit.
- **Conference feed:** a small built-in YAML parser reads the ccfddl dataset; deadlines are converted from their announced timezone (AoE, UTC±N, PT) and compared against your clock.
- No frameworks, no build step, no dependencies — one HTML file with vanilla JS.

## Data sources & credits

| Source | What it provides | License / terms |
|---|---|---|
| [DOAJ](https://doaj.org) | Open access journal metadata | CC BY-SA (journal metadata) |
| [SCImago Journal Rank](https://www.scimagojr.com) | Quartiles, SJR, H-index | Free with attribution; data from Scopus® |
| [ccf-deadlines (ccfddl)](https://github.com/ccfddl/ccf-deadlines) | CS conference deadlines & CCF/CORE ranks | MIT, community-maintained |

The CSV data files are not committed to this repository — download fresh ones from the links above (fresher data = better results).
