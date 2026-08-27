# Community-verified journals (`extra-journals.csv`)

Peer-reviewed open-access journals that are **not (yet) listed in DOAJ**, added
from community submissions (any country) and checked by hand. They appear in
the Journals tab with a violet **Community-verified** tag and an **ⓘ** circle
whose hover popup explains the status; the sidebar toggle *Include
community-verified journals* hides them. A row is skipped automatically if
DOAJ already lists one of its ISSNs, so a journal that later gets into DOAJ
never shows twice.

## Checklist before adding a row (all must hold)

1. Valid ISSN (check on <https://portal.issn.org>).
2. A public **peer-review policy** page and a named **editorial board** with affiliations.
3. An explicit **no author fees** statement (no APC, no submission/other fees) — or fill `APC amount` if there are fees.
4. All articles free to read online (no embargo).
5. At least one issue published in the **last 2 years**.
6. Not on the Beall-style / predatory lists; publisher is an identifiable university, society or institute.

Record where you checked each point in `Evidence URL` (usually the journal's
*About / Editorial policies* page) and the date in `Verified on`.

## Columns

| Column | Notes |
|---|---|
| Journal title | Official title |
| Journal URL | Homepage |
| ISSN (print) / EISSN | `NNNN-NNNN`; at least one required |
| Publisher, Country, Languages | As on the journal site (`Country` must match DOAJ spelling, e.g. `Morocco`) |
| Review process | e.g. `Double anonymous peer review` |
| Subjects | Free text, `;`-separated |
| Keywords | `,`-separated, used by search |
| APC / Has other fees | `No` (default) or `Yes` |
| APC amount | e.g. `500 MAD` when `APC` is `Yes` |
| Weeks to publication | Average submission→publication, if stated |
| Source | `community` (default), `imist`, `road`, … |
| Verified on | `YYYY-MM-DD` |
| Notes | One line shown in the ⓘ popup |
| Evidence URL | Page proving the checklist |

Best long-term fix is still to encourage the journal to apply to DOAJ
(<https://doaj.org/apply/>, free, ~3 months); it is then picked up by the
regular DOAJ refresh and the row here becomes redundant.
