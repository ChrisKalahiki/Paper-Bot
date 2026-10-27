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

After missed or failed days, a Scan catches up. arXiv counts as covered through the date of the last Daily Scan that didn't fail and read arXiv. When that is before yesterday, the Scan asks the arXiv query API (`submittedDate`, one request per 3 seconds) for every Paper submitted since 3 days before that date (the oldest deadline its RSS feed could have ended at), at most 7 days back, in place of the RSS feed; Papers already stored or pending drop out, and reads HF daily papers for each date it covers. It writes one Daily Briefing named for today, still with at most 5 Picks, whose take starts "Covers Oct 24–26." The first Scan is an ordinary one: arXiv's latest announcement, and OpenAlex and ERIC's whole windows, ranked up to the batch cap. Each Scan deletes the abstracts of Papers first seen over 30 days ago that were never Picked, and its logs older than 90 days.

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

## Schedule

`launchd/dev.paper-bot.scan.plist` is a LaunchAgent template (label `dev.paper-bot.scan`) that starts `paper-bot scan` at 06:00 local time every day, or when the Mac wakes if it was asleep then. Install it from the checkout launchd should use, in a shell where `codex` is on PATH (with nvm, after `nvm use`):

```sh
bun scripts/install-launch-agent.ts
launchctl print gui/$(id -u)/dev.paper-bot.scan   # loaded; "runs" counts the Scans started so far
```

The script fills in the template with this checkout, this `bun`, your home folder and username, and the folder holding `codex`, writes it to `~/Library/LaunchAgents/dev.paper-bot.scan.plist`, creates `~/Library/Logs/paper-bot`, and loads it into your login session with `launchctl bootstrap`, replacing an earlier install. The agent sets `HOME`, `USER` and `LOGNAME` (without them `claude -p` reports "Not logged in") and a `PATH` of the `codex` folder (its `node` too), bun's folder, `~/.local/bin` (`claude`, `brain-dump`) and the system folders. `claude` reads its login from the Keychain, so you must be logged in to the Mac for a Scan to reach it.

The `codex` folder is written into the plist. With nvm it names the Node version, so after an nvm upgrade the Scans fail with `cannot start codex`: install again. Install again too after moving the checkout or reinstalling bun.

To start a Scan now: `launchctl kickstart gui/$(id -u)/dev.paper-bot.scan`. To uninstall:

```sh
launchctl bootout gui/$(id -u)/dev.paper-bot.scan
rm ~/Library/LaunchAgents/dev.paper-bot.scan.plist
```

Logs are in `~/Library/Logs/paper-bot/`: each Scan's own log (`<date>-daily.log`, `<date>-weekly.log`), and what launchd caught of its output, `launchd.out.log` (how each Scan settled) and `launchd.err.log` (why a Scan failed or could not start).

## Checks

`bun run check` is the typecheck, Biome lint, the Glossary check and the tests. The Glossary check (`bun run glossary`) fails on any `_Avoid_:` term from `GLOSSARY.md` in the README, CLAUDE.md, prompts, or string literals in `src/`; terms with a common other sense are listed as unchecked in `scripts/glossary.ts`. `bun install` points git at `.githooks`, whose pre-commit hook calls `check`. CI checks every push and PR the same way.

Tests drive the real Scan against recorded responses from every source, fake `codex`, `claude` and `brain-dump`, a temporary store and a fixed clock. Nothing reaches the network, an LLM or the Vault.

## Prompt evals

The evals put the writing prompts to the pinned model against committed synthetic fixtures in `evals/fixtures/`, by hand, as in Brain-Dump:

- `bun run eval [name] [--runs N]` sends each fixture N times (3 by default) through the production prompt, schema and `claude -p` call, on the `models.write` pinned in `config.example.json`. Deterministic checks decide pass or fail; a rubric grade from the same model is printed beside them and never gates. When every attempt at every fixture passes, with at least 3 attempts each, the eval's input hash goes into `evals/passed.json`; commit it.
- `bun run eval:check` fails while any eval has no recorded pass, or its inputs changed since: the model, a fixture, `GLOSSARY.md`, or any module the eval reaches through its imports (prompts live in `src/prompts.ts`, so editing one makes its evals stale). It stays out of `bun run check`, so a commit isn't blocked by an eval not yet rerun; CI calls it after `check` and fails until the evals are rerun and their passes committed.

The evals:

- `daily`, fixtures for a normal day (5 Picks, 3 Interests), a thin day (a Pick and a Wildcard) and a catch-up (arXiv last covered on 23 Oct, so it covers 24–26 Oct). It checks the schema; one entry per Pick, none missing, repeated or extra; why ≤ 30 words, summary ≤ 2 sentences, take ≤ 60 words; that the catch-up's take, as rendered after its "Covers Oct 24–26." line, names its first and last days; no URL, arXiv id, DOI or quoted title that isn't in the prompt; and no `_Avoid_:` term from `GLOSSARY.md` that would name paper-bot's own concepts, such as `Digest` or `roundup` (avoided terms that are ordinary English about a Paper, such as `run`, `job` or `article`, are excluded in `evals/assertions.ts`). Rubric: faithful to the abstract, a take worth reading.
- `weekly`, one week of 15 Picks across 3 Interests and a Wildcard. It checks the schema, 2–4 themes (the production schema allows 1 for a thin week), that each theme cites at least 2 of the week's Picks by title, no URL or title that isn't in the prompt, and, in the rendered Weekly Briefing, that every Top Pick is one of the week's. Rubric: themes are trends, not a restatement of the Interests.
- `keep`, a Kept Pick whose summary came from its full text, one from its abstract only, and a Wildcard. It checks 2–4 Learnings, each one line and one sentence that doesn't lean on another ("It also…"), then renders the Dump as a Keep does and hands it to `brain-dump write-dump --origin briefing … --dry-run` on it. Until Brain-Dump ships `--dry-run` and the Briefing origin (Brain-Dump#127), every `keep` case fails with that reason. Rubric: self-contained, worth keeping.
