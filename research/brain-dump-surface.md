# Brain-Dump's read and write surface for paper-bot

Resolves [paper-bot#3](https://github.com/ChrisKalahiki/paper-bot/issues/3). Facts and options only; the carve-out itself is ticket #5.

Sources are in `/Users/kali/Projects/Brain-Dump` (read-only, as of 2026-10-26): `src/`, `docs/adr/`, `GLOSSARY.md`, `README.md`, `docs/spec/v2.md`, and Brain-Dump issue #117. Paths below are relative to that repo. Terms follow both GLOSSARY.md files: Vault, Inbox, Curated Note, Filing, Filing Plan, Dump, Run, Sweep (Brain-Dump); Briefing, Pick, Keep, Interests Note (paper-bot).

Decided inputs (map issue #1): Interests live in an Interests Note in the Vault, read through a `brain-dump` command; Briefings go into their own Vault area without a Filing Plan; a Pick ticked as Keep becomes a Dump in the Inbox for normal Filing.

## Short answer

1. **Read.** `brain-dump show <note> --full` can already return an Interests Note, but only if the note sits inside the write allowlist (`Inbox`, `Research/Main Notes`, `Research/Weekly Meetings`, `Side Projects`, `Resources`). `show` returns raw Markdown text plus a hash. There is no structured "list the Interests" command.
2. **Write Briefings.** Nothing today permits it. The gateway lets "automation" create only top-level Inbox files and lets "approved-plan" write only after a user-approved plan. An unattended writer creating Briefings in their own area is a third case. It needs a new allowlisted tree, a new gateway actor or mode, and amendments to ADRs 0004 and 0005, with ADRs 0002, 0003, 0006 and 0007 touched.
3. **Keep to Dump.** `write-dump` is the right shape (create-new, Inbox, one Run, undoable), and a Kept Pick fits ADR 0004 as-is. But its inputs are Session-shaped: five fixed tool tags, a Dump body of Learnings/Decisions/Todos Items only, and origin lines that say "Session: …". The Dump format and `--tool` need an extension.
4. **Guard.** The Vault guard is a Claude Code / Codex PreToolUse hook. It never sees a process that is not one of those agents' tool calls. If paper-bot shells out to `brain-dump` itself, as homeros does, the guard is not involved.

## (a) Which commands could read an Interests Note, and what is missing

### Existing read commands

Dispatch is in `src/cli.ts:26-129`. Commands that read Curated Notes:

| Command | What it returns | Source |
|---|---|---|
| `show <note> [--full]` | JSON `{note, hash, text, truncated}`. `<note>` is a Vault-relative path, a title or a `[[wikilink]]`. | `src/cli.ts:46-51`, `src/show.ts:10-19` |
| `recall <terms…>` / `--project` / `--links` | JSON of Items (Learnings, Decisions, Todos) and wikilink lines, capped at 20. | `src/recall.ts:13-49`, `src/recall.ts:87-95` |
| `list-notes` | JSON `{note, title, folder, tags, hash}` for every note in the allowlist outside the Inbox. | `src/notes.ts:7-22`, `src/cli.ts:40-42` |
| `routes` | The Routes note. | `src/cli.ts:52-54` |

`show` is the only one that returns the body of an arbitrary Curated Note. The others return Items or metadata.

### Constraints on using `show` for the Interests Note

- **Allowlist.** `findNote` searches only `noteFiles(vault)`, which defaults to `WRITE_ALLOWLIST` (`src/show.ts:29-36`, `src/notes.ts:25-31`). A note outside it fails with "is not a note in the write allowlist". The allowlist is defined in code (`src/layout.ts:11-12`). Where Chris keeps the Interests Note is not recorded in any source read here; if it is not under one of the five trees, `show` cannot reach it. Making it reachable means editing `WRITE_ALLOWLIST` (ADR 0004).
- **Truncation.** By default `show` returns only from the note's latest Digest onward (`src/show.ts:12-19`, `src/show.ts:22-26`) and caps text at 60,000 characters unless `--full` (`src/show.ts:8`, `:17`). An Interests Note should be read with `--full`. Output reports `truncated`.
- **No structure.** `text` is raw Markdown. paper-bot would parse the Interests format itself, which is the duplication Brain-Dump issue #117 was written to avoid ("Any tool that wants them would have to parse the note, duplicating the format Brain-Dump owns").
- **Name ambiguity.** A bare title matching several notes errors and asks for a path (`src/show.ts:37-40`). A Vault-relative path avoids this.
- **Read-only fits.** `show` is read-only, matching "paper-bot reads and never writes" the Interests Note (paper-bot `GLOSSARY.md`, Interests Note).

### Gaps

1. A way to read the Interests Note without hard-coding its path or parsing Markdown in paper-bot. Options: `show` with a configured path (works today if allowlisted), or a new `interests` command following the `todos` pattern (see (e)). Which is better is open.
2. Possibly a configured location for the Interests Note, if a dedicated command is added. Config today is `~/.config/brain-dump/config` `name = value` lines (`src/vault.ts:47-56`; `vault` and `sweep-opt-out` are the existing settings, `README.md:32-36`). ADR 0004 rejects an allowlist in a Vault note or per-machine config (`docs/adr/0004-inbox-and-curated-notes.md:13`), but that is about the allowlist, not about naming one note.

## (b) What the ADRs say about an unattended Briefing writer with no Filing Plan

### Current rules that apply

| ADR | What it says | Effect on Briefings |
|---|---|---|
| 0002 (`docs/adr/0002-helper-cli-owns-vault-io.md:1-10`) | The `brain-dump` helper owns every Vault read and write; applying an approved Filing Plan is among the mechanical work it does. | paper-bot cannot write Briefings with its own file IO. It must call a `brain-dump` command, so Brain-Dump has to grow a Briefing-writing command. |
| 0003 (`docs/adr/0003-append-only-stays-absolute.md:1-7`) | Nothing in a Curated Note is ever removed or rewritten; only ADR 0011 narrows it for Todo marks. | A Briefing is a new file, which append-only does not forbid. A Briefing that is regenerated or edited in place is a rewrite of a Curated Note and is not allowed. A Weekly Briefing "drawn from that week's Daily Briefings" (paper-bot `GLOSSARY.md`, Briefing) must therefore be a new file, or an append-only addition. |
| 0004 (`docs/adr/0004-inbox-and-curated-notes.md:1-5`) | "Automation only creates Dumps." Every Curated Note, meaning anything outside the Inbox, changes only through an approved plan. The helper writes only under an in-code allowlist. | Directly in tension. A Briefing outside the Inbox is a Curated Note (`GLOSSARY.md:57-59`). Writing it unattended without a Filing Plan is what the ADR forbids. Its Considered Options also reject widening automation beyond new Dumps (line 11) and reject config-driven allowlists (line 13). |
| 0005 (`docs/adr/0005-one-write-gateway.md:3-15`) | Every write goes through one gateway enforcing path, size and mode (create-new, append-only, checkbox-only, todo-mark, revert). "There is no override flag." | See the gateway code below. A new actor or mode, plus a path rule, would be a gateway change. The ADR's Considered Options reject per-command checks (line 20): a new writer should extend the gateway, not bypass it. |
| 0006 (`docs/adr/0006-undo-restores-exactly.md:3-5`) | Each Run is journaled outside the Vault and can be undone whole; undo refuses if any file changed since. | A Briefing Run is undoable only until Chris edits the file (for example ticking a Keep). Consistent with the ADR, but a Briefing can be undone only before it is touched. |
| 0007 (`docs/adr/0007-agents-read-through-the-helper.md:3-7`) | Agents read only through the helper, and only within the write allowlist. | A Briefing area inside the allowlist becomes readable by `recall`, `show` and `list-notes`, and so reaches model providers whenever an agent recalls on its own. A Briefing area outside the allowlist would be unreadable by `show` for the Keep step. |
| 0009 (`docs/adr/0009-the-sweep-calls-the-agent.md:3`) | The Sweep is a helper-started, tool-less agent run per Session; the helper writes the result. | The nearest precedent for an unattended, scheduled writer. It writes only Dumps and gives no route to writing outside the Inbox. |

### Gateway behaviour today

- **Automation.** `commit(..., "automation", ...)` allows only `mode: "create"` at a path whose parent is exactly `Inbox` and that is not the Routes note: `src/gateway.ts:84-87`. A Briefing in any other folder would throw "automation may only create new Dumps in the Inbox".
- **Approved plan.** The "approved-plan" actor is barred from creating Inbox files except a Dump's own filing or the Routes note (`src/gateway.ts:88-90`), but may write elsewhere in the allowlist. Its meaning is "the user approved this plan" (`src/gateway.ts:23-24`). Using it for an unattended Briefing would mislabel the actor and sidestep the intent of ADR 0004.
- **Path.** Targets must be inside `WRITE_ALLOWLIST` (`src/gateway.ts:75-78`). There is no Briefing tree today (`src/layout.ts:12`).
- **Size.** More than 8 notes needs `confirmLarge` (`src/gateway.ts:42`, `:94-97`). Daily Briefings are one note per Run, so this does not bite.
- **Create-new** refuses to overwrite (`src/gateway.ts:123-125`), which suits one Briefing per period.
- **New folders** are made on demand by `stage` (`src/gateway.ts:108-109`), so a Briefing subfolder needs only an allowlisted parent.
- **Run label.** `RunInfo.command` is a closed union (`src/runs.ts:23`); a Briefing writer needs a new command name.

### What this implies for ADRs

1. **ADR 0004 must be amended or superseded.** Its headline and first paragraph state that automation only creates Dumps. A Briefing area is a second place automation may create files, so the ADR needs a carve-out, or a new ADR narrowing 0004 to "Curated Notes except the Briefing area". The allowlist-in-code rule (`docs/adr/0004-...:5`, `:13`) means the Briefing tree is a code change in `src/layout.ts`.
2. **ADR 0005 must be amended.** A new actor or mode, and its path rule, are gateway rules; the ADR lists what the gateway enforces (`docs/adr/0005-...:5-15`). The Actor type is `"automation" | "approved-plan"` (`src/gateway.ts:24`).
3. **ADR 0002 probably needs only a mention.** A new `brain-dump` command stays inside it.
4. **ADR 0007 is touched by the allowlist decision.** Briefings inside the allowlist are recall-visible and `list-notes`-visible (see "Side effects" below). Outside it, `show` breaks for the Keep step.
5. **ADR 0003 and 0006 are consistent if Briefings are new files**, and are touched (not necessarily amended) in two ways: Weekly Briefings must not rewrite Daily ones, and a Briefing stops being undoable the moment Chris edits it.
6. **ADR 0009 is not amended.** It is the precedent for a scheduled unattended writer. The Sweep's glossary entry says it writes "only new Dumps into the Inbox" (`GLOSSARY.md:41-43`), so a Briefing writer is not the Sweep and would need its own term.

### Side effects of putting a Briefing area in the allowlist

All of these follow from existing code reading the whole allowlist:

- `list-notes` returns every allowlisted note outside the Inbox "so Filing never proposes a private note or a Dump" (`src/notes.ts:15-22`). Briefings would be offered as Filing destinations.
- `recall` and `check` read Items from all allowlisted Curated Notes through `readVaultItems` (`src/vault-items.ts:30-47`, `src/check.ts:26`). A bullet counts as an Item if it has a `Why:` or `From [[…]]` child, or a `#todo` tag (`src/curated.ts:32-44`). Briefing bullets using `#todo` or those child lines would be read as filed Items; plain Pick bullets would not.
- `recall --links` scans every allowlisted line for wikilinks (`src/recall.ts:87-95`), so wikilinks in Briefings appear in link results.
- The Vault pointer and near-duplicate detection also read `readVaultItems` (`src/pointer.ts:27`, `src/duplicates.ts:51`, `src/filing.ts:194`).

## (c) How the Sweep writes Dumps, and whether a Kept Pick could become a Dump the same way

### The Sweep path

1. `brain-dump sweep` finds candidate Sessions, drafts one Dump per Session with a tool-less `claude -p` (`src/drafting.ts:15`; ADR 0009), and calls `writeDumps` once for all of them (`src/sweep.ts:89`).
2. `writeDumps` (`src/dump.ts:144-158`) picks a free filename per Dump and calls `commit(vault, "automation", run, creates)`, so all Dumps are one Run. The Run is `{command: "sweep", label: "swept N Dump(s)"}` (`src/sweep.ts:89`).
3. Tags: `renderContents` writes frontmatter `tags: dump`, `dump/swept` (swept only), `AIGenerated`, then the tool tag, plus `session:` and `through:` when a Session is covered (`src/dump.ts:190-195`). The origin line is `Session: <tool> (swept) · …` (`src/dump.ts:125-137`; `docs/spec/v2.md:480`).
4. Body: `renderDumpBody(parseDumpBody(body))` (`src/dump.ts:73`). The body must be `## Learnings`, `## Decisions`, `## Todos` sections of `- [ ]` Items; a Decision needs a `Why:` line; a Todo needs `#todo` (`src/dump-body.ts:3-18`, `:31-75`).
5. A body that looks like it holds a secret is refused (`src/dump.ts:70-71`).
6. Undo: `brain-dump undo <run>` reverts the whole Sweep Run (`README.md:28`, `src/undo.ts:16-33`). Runs are journaled per machine outside the Vault (`src/runs.ts:9`, ADR 0006).
7. Outcome for Chris: Dumps land only in the Inbox, tagged `dump/swept`, for normal Filing (`README.md:28`; `docs/spec/v2.md:149`).

### The one-off path

`brain-dump write-dump --tool … --slug …` with the body on stdin (`src/cli.ts:32-34`, `:138-166`) goes through `writeDump` (`src/dump.ts:56-64`) and `createWithFreeName`, which commits one create as the "automation" actor with Run `{command: "write-dump", label: <filename>}` (`src/dump.ts:171-180`). This is the path a Kept Pick would use if no new command is added.

### Does a Kept Pick fit?

**Fits as is:**
- Creating a new file in the Inbox as "automation" is the one thing ADR 0004 allows, and the gateway already allows it (`src/gateway.ts:84-87`).
- `write-dump` is single-Run and undoable (ADR 0006).
- The Dump then goes through normal Filing (Filing Plan, approval), which is the decided Keep behaviour.

**Does not fit as is:**
1. **Tool tag.** `--tool` must be one of five fixed tags: ClaudeCode, Codex, ClaudeWeb, ChatGPT, Gemini (`src/origin.ts:3-9`, `src/cli.ts:149-151`). paper-bot is none of them. Any value would be a false origin and would appear in the Dump's frontmatter tag and origin line (`src/dump.ts:193`, `:126`).
2. **Origin line says Session.** Every origin line begins `Session: ` (`src/dump.ts:19`, `:126`), and `parseDump` rejects Dumps without it (`src/dump.ts:101`). A Pick is not a Session.
3. **Dev origin needs a git repo.** For ClaudeCode/Codex the origin is detected from `process.cwd()`, and Project is the main worktree's folder name (`src/origin.ts:57-68`). paper-bot's checkout lives at `/Users/kali/Projects/bot`, so the Project would be `bot`, not `paper-bot`, unless run elsewhere.
4. **Chat origin** rejects `--swept` and accepts `--chat-url` and `--project` only for chat tools (`src/dump.ts:80`, `src/cli.ts:155-158`). A chat origin can carry a URL, which could hold a Paper link, but the tags would still be ClaudeWeb/ChatGPT/Gemini.
5. **Item shape.** A Kept Pick must be written as a Learning (or Todo) Item: one line, no `Why:` child for a Learning (`src/dump-body.ts:77-86`). The Paper's link, title and summary must fit one line. Filing later adds `From [[dump]]` (`src/curated.ts:46-52`).
6. **Secrets filter.** The body goes through `findSecret` (`src/dump.ts:70`). Abstracts are unlikely to trip it, but a refusal (`SecretRefusedError`) means the Keep silently fails unless paper-bot handles it.
7. **Dedupe.** The Sweep avoids duplicates via `session:`/`through:` frontmatter and a ledger (`src/sweep.ts:65`, `src/dump.ts:192`). A Keep has no equivalent. If paper-bot re-reads a Briefing, nothing in `write-dump` stops it writing the same Dump twice; near-duplicate detection exists but only at Filing time (`src/filing.ts:194`, `src/duplicates.ts`). Tracking which Keeps already became Dumps is open.
8. **How a tick is read.** The Keep is Chris ticking a box in a Briefing in Obsidian, outside the helper. paper-bot would read the Briefing with `show` (requires the Briefing area to be allowlisted, see (b)) and find ticked lines. The helper marks nothing in a Briefing; ADR 0011 allows mark changes only in Weekly Notes' to-do sections (`docs/adr/0011-a-todos-mark-may-change.md:5`, `src/gateway.ts:91`), and Chris's own edits are not gated.
9. **Sweep interaction.** The Sweep skips Sessions in the Vault and Sessions with fewer than 3 user messages (`README.md:32`, `src/sweep.ts:22`, `:65`). If paper-bot's daily run is a Claude Code Session, it could be a Sweep candidate; the opt-out is `sweep-opt-out` in `~/.config/brain-dump/config` (`src/sweep.ts:25`, `README.md:32-36`).

## (d) How the Vault guard treats a paper-bot process

### What the guard is

`brain-dump guard` is a PreToolUse hook installed into `~/.claude/settings.json` and `~/.codex/hooks.json` (`README.md:18`). The CLI reads the hook's JSON on stdin and exits 2 to block (`src/cli.ts:85-96`). It enforces ADR 0007 and describes itself as catching "agents drifting off the helper, not determined evasion" (`src/guard.ts:5-6`).

### Rules (`src/guard.ts:46-67`)

- Stands down when `CLAUDE_PROJECT_DIR` is inside the Vault (`src/guard.ts:50`).
- Denies file tools (Edit, Write, NotebookEdit, MultiEdit, Read, Grep, Glob) whose resolved path is inside the Vault (`src/guard.ts:8`, `:51-55`).
- For Bash, denies when the working directory is in the Vault or the command names the Vault, unless the command is a single `brain-dump …` call (`src/guard.ts:61-65`, `:119-126`). No pipes, `;`, `&`, redirects or substitutions; at most one quoted heredoc.
- The Codex guard is best effort (`README.md:20`).

### Consequences for paper-bot

| How paper-bot runs `brain-dump` | Guard effect |
|---|---|
| A plain subprocess from paper-bot's own code, as homeros runs `brain-dump todos` under Node (Brain-Dump issue #117, Further Notes) | None. The guard only sees tool calls inside a Claude Code or Codex session; it does not wrap other processes. |
| paper-bot uses `claude -p` with a Bash tool and the hook is installed | The guard sees each Bash call. A single `brain-dump show "…" --full` passes (`src/guard.ts:119-126`). Anything that pipes, chains commands or uses `$(...)` fails the single-call check and is denied (`src/guard.ts:142`, `:161`). Direct file tools on Vault paths are denied. |
| paper-bot is launched with `CLAUDE_PROJECT_DIR` inside the Vault | The guard stands down entirely (`src/guard.ts:50`). Not a pattern to rely on. |
| `claude -p --safe-mode` with no tools, as the Sweep uses (`src/drafting.ts:15`) | No tool calls, so nothing to guard. |

The guard is not a write control. The write gateway (ADR 0005) and undo (ADR 0006) are the safety net (`src/guard.ts:5-6`). The guard would neither stop nor permit a Briefing write; the gateway decides.

The deny message lists the allowed commands as "recall, show, write-dump, file" (`src/guard.ts:70`). A new `interests` or `write-briefing` command is not named there, but the message is advice only; the check is "single `brain-dump` call", not a command list (`src/guard.ts:119-126`).

Observed while writing this note: the guard denied a single Bash call whose heredoc text merely contained the words "The Vault", because the command named the Vault and was not a single `brain-dump` call (`src/guard.ts:61-65`, `:106-114`). A paper-bot agent session with the hook installed that writes prose mentioning the Vault through Bash would hit the same denial.

## (e) The JSON command contract pattern (homeros) as a template

### Pattern

Source: Brain-Dump issue #117 (closed), "todos lists this week's Todos with their state, Todo Group and parent", plus `src/cli.ts:67-72` and `src/todo-groups.ts:31-50`.

- **Why.** Another tool should not parse the Vault format Brain-Dump owns (issue #117, Problem Statement, citing ADR 0002 and ADR 0007).
- **Command.** Read-only, flag-driven (`todos --date <YYYY-MM-DD>`), required flags validated with `UsageError` and exit code 2 (`src/cli.ts:67-72`, `:209-210`).
- **Output.** JSON via `writeJson` (`src/cli.ts:191-193`) with a documented TypeScript type: `note` (Vault-relative path), `exists`, `hash` (null when absent), then the data list (issue #117, Implementation Decisions; implemented as `WeekTodos`, `src/todo-groups.ts:39`).
- **Absent is not an error.** `exists: false` and an empty list (issue #117, user story 3; `src/todo-groups.ts:41-45`).
- **Hash** is the content hash of the whole note so the consumer detects change, and a later write can pass it back as an expected hash: `mark-todos --hash` refuses a stale note (`src/mark-todos.ts:33-39`, `src/cli.ts:73-78`).
- **Format rules stay in one place.** The command reuses the parser behind `todo-groups` (issue #117, "Reading the section").
- **Tests.** At the command against a fixture Vault (ADR 0002), plus format-module round trips (ADR 0010; issue #117, Testing Decisions).
- **Permission.** Inside `Bash(brain-dump:*)`, no new permission (issue #117, user story 20; skills declare `allowed-tools: Bash(brain-dump:*)`, e.g. `skills/todo/SKILL.md:4`).
- **Consumer contract.** The consumer runs the command under Node and parses its JSON; the output type is the contract (issue #117, Further Notes).
- **A write counterpart** follows the same shape: `mark-todos --date --hash --line n=state`, one call, one Run, refusal when stale, returns `{run, note, hash, changed, unchanged}` (`src/mark-todos.ts:16`, `:34-61`).

### The `vault` command

`brain-dump vault` is not JSON: it prints the resolved Vault root as plain text plus a newline (`src/cli.ts:29-31`), and `locateVault` creates the Inbox if absent (`src/vault.ts:14-22`). There is no JSON `vault` contract to copy. No separate Brain-Dump issue for `vault` was read.

### Applying the template to paper-bot

- **Read Interests**: an `interests` command returning `{note, exists, hash, interests: [...]}` mirrors `todos`. Alternative: `show --full` and parse in paper-bot.
- **Read Keeps**: a command returning ticked Picks of a Briefing mirrors `todos` returning checkbox states.
- **Write**: `mark-todos` is the template for a hash-guarded write; `write-dump` is the template for creating files.

## Commands paper-bot would need

Proposals only, derived from the above. Names are placeholders.

| # | Command | New or changed | What it does | ADRs touched |
|---|---|---|---|---|
| 1 | `show <Interests Note> --full` | Existing, possibly unchanged | Reads the Interests Note as raw Markdown. Works today only if the note is in `WRITE_ALLOWLIST`. | 0007 (read within allowlist); 0004 if the allowlist must grow |
| 2 | `interests` | New (optional) | Read-only JSON `{note, exists, hash, interests[]}` per the #117 pattern; removes Interests parsing from paper-bot. Needs a defined Interests Note format and location. | 0002, 0007; 0004 if the note's folder is added to the allowlist |
| 3 | `write-briefing` (or a Briefing mode of an existing writer) | New | Creates one new Briefing note in a Briefing tree as one Run, with no Filing Plan, refusing to overwrite. Needs a Briefing tree in `WRITE_ALLOWLIST`, a gateway actor or mode that permits it unattended, a new `RunInfo.command`, and an undo story for edited files. | 0002, 0004 (amend or supersede), 0005 (amend), 0006, 0003 (new files only), 0007 (allowlist effects) |
| 4 | `show` / `list-notes` over the Briefing area | Changed by the allowlist decision | `show` reads a Briefing back to find Keeps; `list-notes` would start listing Briefings as Filing destinations unless the Briefing tree is excluded. | 0007, 0004 |
| 5 | `briefing-keeps` (or reuse `show`) | New (optional) | Read-only JSON of the ticked Picks in a Briefing, with the note's hash. | 0002, 0007 |
| 6 | `write-dump` | Changed | Accept a non-Session origin (new `--tool` value or new origin kind), a one-line Learning for a Pick with a Paper link, and a dedupe key so a Keep is not written twice. Today: fixed tool tags, "Session:" origin line, no Keep dedupe. | 0004 (still only creates Dumps, no amendment), 0002, 0006 (unchanged); Brain-Dump `GLOSSARY.md` (Dump, Sweep wording) |
| 7 | `check` / Vault pointer | Possibly changed | Decide whether Briefings are checked and counted as Curated Notes. | 0007, 0004 |

## Open points for ticket #5 and later

- Where Chris keeps the Interests Note, and whether it is under an allowlisted tree.
- Whether the Briefing tree is inside the allowlist (Keep reading works; Filing, recall and check side effects) or outside it (clean separation, but `show` cannot read Keeps).
- Whether a Weekly Briefing is a new file referencing Daily Briefings or an append (ADR 0003 forbids rewriting).
- How a Keep is made idempotent.
- Whether paper-bot calls `brain-dump` as a subprocess (guard irrelevant) or through a Claude Code/Codex session (guard applies to its Bash calls).
