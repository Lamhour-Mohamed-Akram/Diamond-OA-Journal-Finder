# Open Access Journal & Conference Finder

**▶ Live app: [openaccessfinder.de](https://openaccessfinder.de/)**

A **lightweight static web app** (plain HTML/CSS/JS, no bundler, no frameworks) for researchers deciding where to publish:

- **Journals tab** — find **open access journals**: **Diamond OA** (free to publish *and* free to read — no APC, no hidden fees) by default, with one click to include APC journals (fees shown on each card). All cross-referenced with **SCImago** rankings (quartile, SJR, H-index) and DOAJ metadata (turnaround time, peer-review type, country, languages, subjects). Every journal card has a **"Check Scopus"** button that opens a popup with a **live verdict from the Scopus API** (indexed or not, document count, most recent indexed paper).
- **✦ AI match tab** — paste your abstract (and a subject) and get the journals whose scope is closest to your paper, each with a match score and a one-line "why". A tiny sentence-embedding model (all-MiniLM-L6-v2, ~23 MB) runs **inside your browser** via Transformers.js and is compared against precomputed vectors of every DOAJ journal — no API key, no server, no cost, nothing uploaded. Same fee / quartile / subject filters as the Journals tab.
- **Conferences tab** — two sources:
  - **Worldwide CS** — ranked computer-science conferences (CCF + CORE ranks) with live upcoming **submission deadlines**, dates, locations, and links.
  - **Morocco** — research events in Morocco from the **CNRST** agenda (all disciplines), with event dates, countdowns, and discipline filters.
- **Scopus ✓ tab** — check whether *any* journal or paper is indexed in Scopus: type an **ISSN** or a paper **DOI** for a live check straight from the Scopus API, or a journal name to search the offline SCImago snapshot (~32,000 sources, with a warning when Scopus coverage ended — useful against predatory "Scopus indexed" claims).

Everything runs **entirely in your browser**. No server, no account, nothing is uploaded anywhere. Loaded data is cached locally (IndexedDB) so the app opens instantly next time.

## Quick start

Open the hosted app at **[openaccessfinder.de](https://openaccessfinder.de/)** — that's the whole quick start. On the first visit the app automatically loads the DOAJ + SCImago snapshots from [`data/`](data/) (a few MB, with a progress indicator — fetched from GitHub's CDN to keep hosting bandwidth free, with the site's own copy as fallback), joins them on ISSN, and caches the result on your device; every later visit opens straight into the journal list. Data refreshes reach users as soon as they're committed — no redeploy needed.

To self-host, clone this repo and serve the folder (e.g. `python3 -m http.server`). Opening `index.html` directly from disk also works, but then the built-in data can't be auto-fetched — load the files manually as below.

Prefer the very latest data? Click **"Load newer data…"** in the sidebar (the **"← Back to the journals"** button returns without reloading) and drop in fresh files:

1. Download the DOAJ journal CSV from [doaj.org/csv](https://doaj.org/csv) (the download starts by itself) and drop it in.
2. Download the SCImago rank CSV from [scimagojr.com/journalrank.php](https://www.scimagojr.com/journalrank.php) (*"Download"* button) and drop it in. **Tip:** download the full default list for best results — filtered exports (one category, one region, …) are accepted too, but journals outside the filter will show as unranked.

(The SCImago download link sits behind a bot-protection wall, so the app can't fetch it live — that's why a snapshot is bundled instead.)

The **Conferences** tab needs no files at all — it fetches the open [ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) feed live (cached for 24 h). There is also a *"Just looking for conferences?"* shortcut on the start screen.

The **Morocco** source loads automatically too: the CNRST server doesn't allow cross-site fetching, so a [GitHub Action](.github/workflows/mirror-cnrst.yml) in this repo mirrors the [CNRST events RSS feed](https://www.cnrst.ma/fr/liste-des-evenements/list?format=feed&type=rss) daily into [`cnrst.xml`](cnrst.xml), which the app fetches from GitHub. If the mirror is ever unreachable, the app falls back to letting you save the feed and drop the file in manually.

## Features

### Journals

- Filter by publication fees — Diamond (free) and/or APC journals, with APC amounts shown per journal
- Filter by SJR quartile (Q1–Q4 / unranked), subject area, country, max weeks to publication, SCImago-indexed only
- Full-text search across title, publisher, subjects, and country
- Sort by quartile, SJR, H-index, turnaround, or title
- Direct links to each journal's website and DOAJ record
- **Shortlist**: "+ Add" on any journal card keeps it in a side panel (stored on your device) that exports the picked journals with all their details as CSV
- **Share view**: copies a link that reopens the exact filters, search and sort you are looking at

### AI match

- Paste an abstract (long abstracts are split into chunks and averaged) plus an optional subject line
- Top 15 journals ranked by **match score** = 60 % semantic similarity + 15 % SCImago quartile (unranked = 0) + 10 % subject-area bonus + 10 % keyword overlap + 5 % free-to-publish
- Each result shows the score, a label (excellent / strong / good / possible), the DOAJ keywords it shares with your text, its SCImago categories, and the usual journal card with the Scopus check
- Filters: Diamond / APC, quartiles, indexed-only, SCImago subject area
- 100 % on-device: the model is fetched once from a CDN and cached by the browser; the journal vectors (`data/embeddings.bin`, ~9 MB) come from GitHub and are cached in IndexedDB

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
- **Offline snapshot search** — search all ~32,000 Scopus sources by name, with paginated results; journals whose Scopus coverage ended are flagged (helps catch discontinued and predatory journals)

To self-host the live checks: get a free API key at [dev.elsevier.com](https://dev.elsevier.com), deploy this repo to Netlify, and set the `SCOPUS_API_KEY` environment variable (`netlify env:set SCOPUS_API_KEY <key> --secret`). Everything else works without it.

## How it works

- **Diamond OA definition:** journals in DOAJ with `APC = No` **and** `Has other fees = No`. All ~23,000 DOAJ journals are loaded; the fee filter switches between Diamond and APC journals.
- **Join:** DOAJ records are matched to SCImago rows by normalized print/electronic ISSN.
- **SCImago files:** both the full export (`SJR Best Quartile` column) and filtered per-category/region exports (`SJR Quartile` column) are accepted; the file type is detected automatically from its header.
- **Conference feed:** a small built-in YAML parser reads the ccfddl dataset; deadlines are converted from their announced timezone (AoE, UTC±N, PT) and compared against your clock.
- **AI match:** [`scripts/build-embeddings.mjs`](scripts/build-embeddings.mjs) embeds every DOAJ journal offline (title + DOAJ keywords + DOAJ subjects + SCImago categories — DOAJ has no aims & scope text, only a link) with `Xenova/all-MiniLM-L6-v2` and writes them as int8 vectors to [`data/embeddings.bin`](data/embeddings.bin) (23k × 384, ~9 MB; run `cd scripts && npm install && npm run build:embeddings` after a DOAJ refresh — the refresh workflow does this automatically). In the browser, [`js/ai.js`](js/ai.js) loads the same model through [Transformers.js](https://huggingface.co/docs/transformers.js) (jsDelivr CDN, ONNX int8 weights from the Hugging Face hub), embeds only the visitor's text, and ranks journals by cosine similarity plus the rule-based bonuses above.
- **Live Scopus checks:** a tiny [Netlify serverless function](netlify/functions/scopus.mjs) proxies the Elsevier Scopus Search API so the API key stays server-side (env var `SCOPUS_API_KEY`, never shipped to the browser or committed to this repo). When the proxy is unreachable (e.g. opening the HTML file locally), the app falls back to the offline SCImago snapshot.
- No frameworks, no bundler, no bundled dependencies — plain HTML ([`index.html`](index.html)), one stylesheet ([`css/`](css/)) and ten small vanilla-JS modules ([`js/`](js/)), plus one optional serverless function for the live Scopus checks. The only runtime library is Transformers.js, loaded lazily from a CDN when the AI tab is first used. The only "build" is [`scripts/build-dist.sh`](scripts/build-dist.sh), which copies an explicit allowlist of files into `dist/` so working files can never reach the live site.

## Data sources & credits

| Source | What it provides | License / terms |
| --- | --- | --- |
| [DOAJ](https://doaj.org) | Open access journal metadata | CC BY-SA (journal metadata) |
| [SCImago Journal Rank](https://www.scimagojr.com) | Quartiles, SJR, H-index | Free with attribution; data from Scopus® |
| [sjrdata](https://github.com/ikashnitsky/sjrdata) (I. Kashnitsky) | Mirror used to auto-refresh the SCImago snapshot | MIT |
| [ccf-deadlines (ccfddl)](https://github.com/ccfddl/ccf-deadlines) | CS conference deadlines & CCF/CORE ranks | MIT, community-maintained |
| [CNRST](https://www.cnrst.ma/fr/liste-des-evenements) | Research events in Morocco (RSS) | Public feed from Morocco's National Center for Scientific and Technical Research |
| [Elsevier Scopus API](https://dev.elsevier.com) | Live journal/paper indexing checks | Free API key; requests proxied server-side, key never exposed |
| [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [Transformers.js](https://github.com/huggingface/transformers.js) | On-device sentence embeddings for the AI match | Apache 2.0 |

Bundled snapshots for the one-click load live in [`data/`](data/) and refresh themselves: a [GitHub Action](.github/workflows/refresh-data.yml) runs twice a month (1st and 15th), re-downloading `doaj.csv` from doaj.org and rebuilding `scimago.csv` from [our fork](https://github.com/Lamhour-Mohamed-Akram/sjrdata) of the [sjrdata](https://github.com/ikashnitsky/sjrdata) mirror (MIT, by Ilya Kashnitsky) — scimagojr.com itself blocks scripted downloads, so [`scripts/scimago_from_sjrdata.py`](scripts/scimago_from_sjrdata.py) converts the mirror's latest yearly export back to the official CSV format (verified identical to the official download, all 32k rows). Once a year, when the new SCImago edition lands upstream, hit **"Sync fork"** on the fork so the workflow picks it up. Every replacement is sanity-checked so a bad download never overwrites good data, and the app shows each snapshot's date automatically. Any other CSV in the repo stays untracked.

## Author

Made by **Mohamed-Akram Lamhour** — [LinkedIn](https://www.linkedin.com/in/ak2lamhour/)

<!-- Support link, hidden for now. To show it, remove this comment wrapper:
This is a free, non-profit side project. If it saves you time, you can [☕ support it on Buy Me a Coffee](https://buymeacoffee.com/openaccessfinder).
-->
