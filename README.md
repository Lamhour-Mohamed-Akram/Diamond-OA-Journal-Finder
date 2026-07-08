# Open Access Journal & Conference Finder

**▶ Live app: [diamond-oa-finder.netlify.app](https://diamond-oa-finder.netlify.app/)**

A **lightweight static web app** (plain HTML/CSS/JS, no build step, no frameworks) for researchers deciding where to publish:

- **Journals tab** — find **open access journals**: **Diamond OA** (free to publish *and* free to read — no APC, no hidden fees) by default, with one click to include APC journals (fees shown on each card). All cross-referenced with **SCImago** rankings (quartile, SJR, H-index) and DOAJ metadata (turnaround time, peer-review type, country, languages, subjects). Every journal card has a **"Check Scopus"** button that opens a popup with a **live verdict from the Scopus API** (indexed or not, document count, most recent indexed paper).
- **Conferences tab** — two sources:
  - **Worldwide CS** — ranked computer-science conferences (CCF + CORE ranks) with live upcoming **submission deadlines**, dates, locations, and links.
  - **Morocco** — research events in Morocco from the **CNRST** agenda (all disciplines), with event dates, countdowns, and discipline filters.
- **Scopus ✓ tab** — check whether *any* journal or paper is indexed in Scopus: type an **ISSN** or a paper **DOI** for a live check straight from the Scopus API, or a journal name to search the offline SCImago snapshot (~32,000 sources, with a warning when Scopus coverage ended — useful against predatory "Scopus indexed" claims).

Everything runs **entirely in your browser**. No server, no account, nothing is uploaded anywhere. Loaded data is cached locally (IndexedDB) so the app opens instantly next time.

## Quick start

Use the hosted app at **[diamond-oa-finder.netlify.app](https://diamond-oa-finder.netlify.app/)**, or clone this repo and open [`index.html`](index.html) in any modern browser — it works the same either way.

1. Open the app.
2. Download the DOAJ journal CSV from [doaj.org/csv](https://doaj.org/csv) (the download starts by itself) and drop it in.
3. Download the SCImago rank CSV from [scimagojr.com/journalrank.php](https://www.scimagojr.com/journalrank.php) (*"Download"* button) and drop it in. **Tip:** download the full default list for best results — filtered exports (one category, one region, …) are accepted too, but journals outside the filter will show as unranked.
4. The app joins both sources on ISSN and remembers the result.

The **Conferences** tab needs no files at all — it fetches the open [ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) feed live (cached for 24 h). There is also a *"Just looking for conferences?"* shortcut on the start screen.

The **Morocco** source loads automatically too: the CNRST server doesn't allow cross-site fetching, so a [GitHub Action](.github/workflows/mirror-cnrst.yml) in this repo mirrors the [CNRST events RSS feed](https://www.cnrst.ma/fr/liste-des-evenements/list?format=feed&type=rss) daily into [`cnrst.xml`](cnrst.xml), which the app fetches from GitHub. If the mirror is ever unreachable, the app falls back to letting you save the feed and drop the file in manually.

## Features

### Journals

- Filter by publication fees — Diamond (free) and/or APC journals, with APC amounts shown per journal
- Filter by SJR quartile (Q1–Q4 / unranked), subject area, country, max weeks to publication, SCImago-indexed only
- Full-text search across title, publisher, subjects, and country
- Sort by quartile, SJR, H-index, turnaround, or title
- Direct links to each journal's website and DOAJ record

### Conferences — Worldwide CS

- 350+ CCF-listed CS conferences with CCF rank (A/B/C) and CORE rank (A*–C)
- Next abstract/submission deadline with days-left countdown
- Filter by rank, field (AI, Security, Databases, …), open calls only; search by acronym, name, or place
- Sort by soonest deadline, CCF rank, CORE rank, or A–Z
- Links to each conference website and dblp

### Conferences — Morocco (CNRST)

- 600+ research events across all disciplines (engineering, exact & natural sciences, law/economics, humanities, medical, …)
- Event date with days-left countdown; upcoming events first, past events browsable
- Filter by discipline and upcoming-only; full-text search
- Links to each event's CNRST page

### Scopus check

- **Per-journal popup** — a "Check Scopus" button on every journal card shows a live verdict: indexed or not, how many documents, date of the most recent indexed paper
- **Live ISSN / DOI check** — paste any ISSN or paper DOI in the Scopus ✓ tab for an authoritative answer straight from the Scopus API
- **Offline snapshot search** — search all ~32,000 Scopus sources by name; journals whose Scopus coverage ended are flagged (helps catch discontinued and predatory journals)

To self-host the live checks: get a free API key at [dev.elsevier.com](https://dev.elsevier.com), deploy this repo to Netlify, and set the `SCOPUS_API_KEY` environment variable (`netlify env:set SCOPUS_API_KEY <key> --secret`). Everything else works without it.

## How it works

- **Diamond OA definition:** journals in DOAJ with `APC = No` **and** `Has other fees = No`. All ~23,000 DOAJ journals are loaded; the fee filter switches between Diamond and APC journals.
- **Join:** DOAJ records are matched to SCImago rows by normalized print/electronic ISSN.
- **SCImago files:** both the full export (`SJR Best Quartile` column) and filtered per-category/region exports (`SJR Quartile` column) are accepted; the file type is detected automatically from its header.
- **Conference feed:** a small built-in YAML parser reads the ccfddl dataset; deadlines are converted from their announced timezone (AoE, UTC±N, PT) and compared against your clock.
- **Live Scopus checks:** a tiny [Netlify serverless function](netlify/functions/scopus.mjs) proxies the Elsevier Scopus Search API so the API key stays server-side (env var `SCOPUS_API_KEY`, never shipped to the browser or committed to this repo). When the proxy is unreachable (e.g. opening the HTML file locally), the app falls back to the offline SCImago snapshot.
- No frameworks, no build step, no dependencies — plain HTML ([`index.html`](index.html)), one stylesheet ([`css/`](css/)) and six small vanilla-JS modules ([`js/`](js/)), plus one optional serverless function for the live Scopus checks.

## Data sources & credits

| Source | What it provides | License / terms |
| --- | --- | --- |
| [DOAJ](https://doaj.org) | Open access journal metadata | CC BY-SA (journal metadata) |
| [SCImago Journal Rank](https://www.scimagojr.com) | Quartiles, SJR, H-index | Free with attribution; data from Scopus® |
| [ccf-deadlines (ccfddl)](https://github.com/ccfddl/ccf-deadlines) | CS conference deadlines & CCF/CORE ranks | MIT, community-maintained |
| [CNRST](https://www.cnrst.ma/fr/liste-des-evenements) | Research events in Morocco (RSS) | Public feed from Morocco's National Center for Scientific and Technical Research |
| [Elsevier Scopus API](https://dev.elsevier.com) | Live journal/paper indexing checks | Free API key; requests proxied server-side, key never exposed |

The CSV data files are not committed to this repository — download fresh ones from the links above (fresher data = better results).

## Author

Made by **Mohamed-Akram Lamhour** — [LinkedIn](https://www.linkedin.com/in/ak2lamhour/)
