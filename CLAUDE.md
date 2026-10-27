# paper-bot

A bun + TypeScript CLI with a fixed pipeline: read the Interests Note, fetch Candidates, rank them with `codex exec`, write a Briefing with `claude -p`, and hand it to `brain-dump write-briefing`. The spec is ChrisKalahiki/paper-bot#18; each ticket links its decisions.

## Commands

Always use `bun`, never `npm`.

- `bun run check`: typecheck, Biome lint, Glossary check, tests. The pre-commit hook and CI call it.
- `bun test` or `bun run test:file -- tests/scan.test.ts`: tests.
- `bun run lint:file -- src/scan.ts`: lint some files.
- `bun src/cli.ts scan --daily`: a Daily Scan against the real config, store, sources and CLIs.
- `bun scripts/install-launch-agent.ts`: installs and loads the 06:00 LaunchAgent. Never call it, or `launchctl`, from an agent or a test.

## Layout

- `src/schedule.ts`: the Scans `paper-bot scan` starts; `src/weekly.ts`: the Weekly Scan.
- `src/scan.ts`: the Daily Scan pipeline. `ScanDeps` is the seam: config, store, `fetch`, `exec` and clock are passed in.
- `src/command.ts`: `Exec`, the one way to start `codex`, `claude` and `brain-dump`.
- `src/sources/`: one module per source, fetching through `Fetch` (`src/http.ts`) and returning `Candidate`s; pointers (HF, the labs) return `Pointers`, which `src/pointers.ts` gathers and attaches as signals.
- `src/rank.ts` (`codex exec`), `src/write.ts` (`claude -p`), `src/prompts.ts` (their prompts), `src/full-text.ts` (Picks' arXiv HTML or open-access PDF as text), `src/briefing.ts` (renders the note), `src/brain-dump.ts` (Vault access).
- `src/store.ts`: SQLite. Schema changes are a new entry in `MIGRATIONS`, never an edit to a shipped one.
- `launchd/dev.paper-bot.scan.plist`: the LaunchAgent template that `scripts/install-launch-agent.ts` fills in.
- `tests/harness.ts`: fake `codex`, `claude` and `brain-dump`, recorded responses from every source (`sourcesFetch`) and a fixed clock.

## Rules

- Tests drive the real pipeline at the Scan seam with fakes. Never call real `codex`, `claude`, `brain-dump` or paper sources from a test.
- Reach the Vault only through `brain-dump`. Never read or write Vault files directly.
- Expected failures are `PaperBotError`: one line, no stack trace. A Scan fails only when it can't settle its Briefing.
- Use the vocabulary in `GLOSSARY.md` (Paper, Interest, Candidate, Pick, Wildcard, Scan, Briefing, Keep) in code, prompts and docs, and none of its _Avoid_ words. A Scan is never a `run` and a Briefing never a `Digest`.
