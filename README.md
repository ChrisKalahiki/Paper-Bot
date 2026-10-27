# paper-bot

paper-bot finds new research Papers in Chris's Interests and writes Briefings about them into the Vault through Brain-Dump.

## Daily Scan

`paper-bot scan --daily` (or `paper-bot scan`) is one Daily Scan:

1. reads the Interests Note, `Research/Briefings/Interests.md`, with `brain-dump show --full`. Each `## <Interest>` heading and the paragraph under it is one Interest. A missing note, or one with no Interests, fails the Scan before anything is fetched;
2. fetches today's arXiv announcement for the configured categories from one combined RSS feed, keeping new and cross-listed Papers;
3. drops every Candidate whose id is already in the store, so a Paper is ranked once ever;
4. ranks the rest in batches with `codex exec`, saving each batch's scores as it finishes;
5. picks the top 5 scoring 7 or above that match an Interest. With none, the Scan is skipped and no note is written;
6. has `claude -p` write the take and each Pick's why and summary, renders the Daily Briefing and writes it with `brain-dump write-briefing` to `Research/Briefings/Daily/<date> Daily Briefing.md`;
7. records the Scan and its Picks in the store.

Before step 1, every Scan sends Picks Chris ticked as Keep to the Inbox. It reads each Briefing of the last 30 days with `brain-dump show --full` and finds the ticked `- [x] Keep … ^pick-<id>` lines. For each Paper not yet kept, `claude -p` drafts a header and 2–4 Learnings, and `brain-dump write-dump --origin briefing --briefing <note> --paper <id> --project <first Interest> --slug <title>` writes them as a Dump. A Paper is kept once ever; unticking it later changes nothing. The `keeps` table records each Dump, or the error of a failed write, which is retried on the next Scan. Failed Keeps, and ticked Keep lines with a missing or edited id, are noted in the footer of the Briefing the Scan writes.

It exits 1 when the Scan failed. Each Scan logs to `~/Library/Logs/paper-bot/<date>-daily.log`.

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
- `bars.pick` and `bars.wildcard`: the lowest scores of a Pick and of a Wildcard;
- `batch.size` and `batch.cap`: Candidates per ranking call, and calls per Scan.

The store is SQLite at `$XDG_DATA_HOME/paper-bot/paper-bot.db` (default `~/.local/share`); `PAPER_BOT_DB` overrides the path.

`codex` and `claude` must be logged in, and `brain-dump` must have `write-briefing` and the Briefing origin of `write-dump`.

## Checks

`bun run check` is the typecheck, Biome lint, the Glossary check and the tests. The Glossary check (`bun run glossary`) fails on any `_Avoid_:` term from `GLOSSARY.md` in the README, CLAUDE.md, prompts, or string literals in `src/`; terms with a common other sense are listed as unchecked in `scripts/glossary.ts`. `bun install` points git at `.githooks`, whose pre-commit hook calls `check`. CI checks every push and PR the same way.

Tests drive the real Scan against a fake arXiv feed, fake `codex`, `claude` and `brain-dump`, a temporary store and a fixed clock. Nothing reaches the network, an LLM or the Vault.
