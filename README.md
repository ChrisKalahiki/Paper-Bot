# paper-bot

paper-bot finds new research Papers in Chris's Interests and writes Briefings about them into the Vault through Brain-Dump.

## Daily Scan

`paper-bot scan --daily` is one Daily Scan:

1. reads the Interests Note, `Research/Briefings/Interests.md`, with `brain-dump show --full`. Each `## <Interest>` heading is one Interest: the paragraph under it, then optional `- Venues:` (comma-separated) and `- Avoid:` (semicolon-separated) bullets. `## Wildcards` with "Up to N per Daily Briefing" sets the Wildcard cap (1 when it gives no number; no section means no Wildcards). A missing note, or one with no Interests, fails the Scan before anything is fetched. Unreadable bullets and Venues missing from the config go on an "Interests Note issues" line at the foot of the Briefing, and the Scan goes ahead;
2. fetches Candidates from every source at once: today's arXiv announcement for the configured categories (one combined RSS feed, new and cross-listed Papers); OpenAlex works published in the last 14 days in Education or HCI, plus this and last year's works from the Venues the Interests watch; ERIC's Higher Education records added this year; the newest ICML volume on PMLR; and the JMLR feed. A failed source is recorded and skipped; the Scan fails only when every source fails. Pointers are read alongside and add text signals, never Candidates of their own: the day's HF daily papers ("on HF daily papers"), DeepMind research pages through their JSON-LD `sameAs` link, new Anthropic `/research` posts through the first Paper they link, and OpenAI `Research`/`Publication` feed items by title ("announced by <lab>"). Each lab post is read once; the `lab_posts` table remembers which. A lab Paper with no arXiv id or DOI, such as a transformer-circuits.pub Paper from the last 14 days or a PDF an Anthropic post links, is a Candidate identified by its URL. OpenAlex works published in a configured Venue carry "accepted at <Venue>". A failed pointer is recorded and never fails the Scan;
3. gives each Paper a set of ids (DOI, arXiv id, OpenAlex id, ERIC id, or URL), merges Candidates that share one, and drops every Candidate with an id already in the store, so a Paper is ranked once ever. A stored Paper takes up a matching Candidate's new ids; one matching two Papers is logged and merged into neither;
4. ranks the rest in batches with `codex exec`, given each Interest's Venues and Avoid list and each Candidate's signals as text (never as points added to a score), saving each batch's scores as it finishes. Candidates waiting in the `pending` table go first. A Scan ranks at most `batch.cap` batches; Candidates over the cap, and those in a batch that failed, wait in `pending` with their abstracts for the next Scan. The Scan fails only when every batch fails;
5. picks the top 5 scoring 7 or above that match an Interest and have an abstract, then up to the cap of Wildcards: Candidates matching no Interest that the ranker flagged and scored 8 or above. With none, the Scan is skipped and no note is written;
6. reads each Pick's full text, from its arXiv HTML or else the open-access PDF OpenAlex links (read with `unpdf`), cut to 40,000 characters; a Pick with neither is written from its abstract and marked "(from abstract)";
7. has `claude -p` write the take and each Pick's why and summary, renders the Daily Briefing (the Picks, a collapsed "Also considered" list of the next 6 Candidates, marking those with no abstract, and a footer of Candidate counts per source, a line per failed source, the Interests Note issues and Keep issues) and writes it with `brain-dump write-briefing` to `Research/Briefings/Daily/<date> Daily Briefing.md`;
8. records the Scan and its Picks in the store.

Before step 1, every Scan sends Picks Chris ticked as Keep to the Inbox. It reads each Briefing of the last 30 days with `brain-dump show --full` and finds the ticked `- [x] Keep … ^pick-<id>` lines. For each Paper not yet kept, `claude -p` drafts a header and 2–4 Learnings, and `brain-dump write-dump --origin briefing --briefing <note> --paper <id> --project <first Interest> --slug <title>` writes them as a Dump. A Paper is kept once ever; unticking it later changes nothing. The `keeps` table records each Dump, or the error of a failed write, which is retried on the next Scan. Failed Keeps, and ticked Keep lines with a missing or edited id, are noted in the footer of the Briefing the Scan writes.

Each source fetch and each `codex exec` or `claude -p` call that fails (a timeout, `is_error`, not logged in, a usage limit) is tried once more after 30 seconds. A Scan that lost some sources or ranking batches still writes its Briefing; the footer names what failed, and the `scans` row records it as the reason.

It exits 1 when the Scan failed. Picks are chosen from the scores saved since the last Scan that wrote or skipped its Briefing, so running `paper-bot scan --daily` again after a failed Scan reuses its scores instead of ranking again, and is safe to repeat. Each Scan logs to `~/Library/Logs/paper-bot/<date>-daily.log`, including each command's exit code and duration.

## Weekly Scan

`paper-bot scan --weekly` is one Weekly Scan of the previous ISO week (Monday to Sunday, in the system time zone). It fetches and ranks nothing: it reads the Picks of that week's Daily Briefings from the store, has `claude -p` write two to four themes from them (one for a thin week), and writes the Weekly Briefing with `brain-dump write-briefing` to `Research/Briefings/Weekly/<YYYY-Www> Weekly Briefing.md`, named by ISO week-year (the week of 1 Jan 2027 is `2026-W53`). The Briefing holds the themes, the Interests with no Pick that week, a table of Picks and Keeps per Interest (and Wildcards), the top 5 Picks not yet Kept with the same `- [ ] Keep … ^pick-<id>` lines as a Daily Briefing, the week's Picks already Kept, and links to its Daily Briefings. A week with no Picks is recorded as skipped and writes no note. The `scans` row of a Weekly Scan is dated by the Monday of the week it covers; it logs to `~/Library/Logs/paper-bot/<date>-weekly.log`.

`paper-bot scan` with no flag is what the schedule starts: the Daily Scan, then the Weekly Scan of last week unless a Weekly Scan already wrote or skipped it. That is every Monday, and any later day when Monday's was missed or failed; only last week is caught up. It exits 1 when either Scan failed.

## Picks for homeros

`paper-bot picks --json` prints what homeros's paper-bot Source polls (the contract is in ChrisKalahiki/homeros#77). It opens the store read-only, needs no config, and exits 1 only when it can't read the store.

```json
{ "scans": { "daily":  { "at": "…", "date": "2026-10-26", "outcome": "briefing | skipped | failed", "reason": "…", "sources": [{ "name": "arxiv", "ok": true, "error": null }] },
             "weekly": { "at": "…", "week": "2026-W43", "outcome": "briefing | skipped | failed", "reason": "…" } },
  "keeps": { "failing": [{ "id": "…", "title": "…", "error": "…", "since": "…" }] },
  "week": "2026-W44",
  "picks": [{ "id": "arxiv:2610.32109", "title": "…", "url": "…", "date": "2026-10-26",
              "interests": ["Context management in AI"], "wildcard": false, "why": "…",
              "kept": false, "keptAt": null, "briefing": "Research/Briefings/Daily/2026-10-26 Daily Briefing.md" }] }
```

- `scans.daily` and `scans.weekly` are the last settled Scan of each kind, or `null` before the first. `at` is when it settled, and `reason` is `null` when there is none. A Weekly Scan's `week` is the ISO week it covers.
- `keeps.failing` lists Keeps whose last try failed; `since` is that try.
- `week` is the current ISO week, and `picks` are the Picks of its Daily Briefings, by date and rank. `keptAt` is when the Pick's Keep wrote its Dump.

## Setup

```sh
bun install
mkdir -p ~/.config/paper-bot
cp config.example.json ~/.config/paper-bot/config.json
chmod 600 ~/.config/paper-bot/config.json
```

The config lives at `$XDG_CONFIG_HOME/paper-bot/config.json` (default `~/.config`) and must be mode 600. It holds:

- `models.rank` and `models.write`: the pinned models for `codex exec` and `claude -p`;
- `brainDump`: the `brain-dump` command, by name on PATH or as an absolute path;
- `arxiv.categories`: the arXiv categories to fetch;
- `venues`: each Venue name the Interests Note may use, mapped to its OpenAlex source's id;
- `openalex.key`: the free OpenAlex API key (openalex.org → Settings → API key);
- `bars.pick` and `bars.wildcard`: the lowest scores of a Pick and of a Wildcard;
- `batch.size` and `batch.cap`: Candidates per ranking call, and calls per Scan.

The store is SQLite at `$XDG_DATA_HOME/paper-bot/paper-bot.db` (default `~/.local/share`); `PAPER_BOT_DB` overrides the path.

`codex` and `claude` must be logged in, and `brain-dump` must have `write-briefing` and the Briefing origin of `write-dump`.

## Checks

`bun run check` is the typecheck, Biome lint, the Glossary check and the tests. The Glossary check (`bun run glossary`) fails on any `_Avoid_:` term from `GLOSSARY.md` in the README, CLAUDE.md, prompts, or string literals in `src/`; terms with a common other sense are listed as unchecked in `scripts/glossary.ts`. `bun install` points git at `.githooks`, whose pre-commit hook calls `check`. CI checks every push and PR the same way.

Tests drive the real Scan against recorded responses from every source, fake `codex`, `claude` and `brain-dump`, a temporary store and a fixed clock. Nothing reaches the network, an LLM or the Vault.
