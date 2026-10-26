# Running `codex exec` and `claude -p` headless under launchd

Research for [issue #4](https://github.com/ChrisKalahiki/paper-bot/issues/4). Terms follow `GLOSSARY.md`: **Briefing**, **Pick**, **Interest**.

Decided already (map issue #1): `codex exec` (gpt-6.1-sol via `~/.codex/config.toml`) ranks abstracts into **Picks**; `claude -p` writes **Briefings**. Versions probed on the Mac mini, 2026-10-26: `claude` 2.1.311, `codex-cli` 0.164.0.

## Short answer

- Both runners work unattended from a launchd agent with the existing subscription logins. No API key is needed.
- Brain-Dump's Sweep is a proven template for `claude -p`: one fresh, tool-less, unsaved run per call, prompt on stdin, `cwd` = `$HOME`, the user's shell `PATH` copied into the plist, a hard timeout, and any non-zero exit treated as failure.
- Trap: the child environment needs `HOME` **and** `USER`/`LOGNAME`. With only `HOME` and `PATH`, `claude -p` printed `Not logged in` (exit 1). Adding `USER` and `LOGNAME` fixed it (observed, see below). `codex` worked with only `HOME` and `PATH`.
- Exit status is not enough for `claude -p`: failures print the message as the result on stdout and `is_error` is `true` while `subtype` still reads `"success"`. Check `is_error`.
- Neither CLI has a timeout flag. Use the caller's timeout (as Brain-Dump does) around both.
- For a few calls a day, usage limits are not a practical concern. `claude -p` draws on the Claude subscription allowance; `codex exec` on the ChatGPT-plan allowance.

## 1. Brain-Dump's Sweep: the proven template

All Brain-Dump references are at commit `7a2d4a6` of `/Users/kali/Projects/Brain-Dump`.

**ADR 0009** (`docs/adr/0009-the-sweep-calls-the-agent.md:3`): `brain-dump sweep`, started by a daily per-machine timer, "runs one fresh `claude -p --no-session-persistence` per Session with no tools. The agent only returns a Dump body and slug on stdout; the helper writes it". Rationale: bounded context per Session, its own failure, the agent "can touch nothing", and an unsaved run leaves no transcript for the next Sweep to draft.

**The command** (`src/drafting.ts:14-15`):

```ts
export const DRAFTING_MODEL = "claude-sonnet-5-5";
const DRAFTING_COMMAND = ["claude", "-p", "--no-session-persistence", "--model", DRAFTING_MODEL, "--tools", "", "--strict-mcp-config", "--safe-mode"];
```

**The spawn** (`src/drafting.ts:57-69`): `Bun.spawnSync(command, { stdin: Buffer.from(prompt), cwd: homedir(), timeout: AGENT_TIMEOUT_MS })`, with `AGENT_TIMEOUT_MS = 10 * 60 * 1000` (`src/drafting.ts:11`). Exit 0 gives stdout. Anything else becomes `drafting agent failed (timed out | exit N): <first line of stderr, else stdout>`. A spawn exception becomes `cannot run the drafting agent: ...`. The prompt goes on stdin and the reply comes back on stdout as plain text.

**Reply contract** (`src/drafting.ts:19-26, 71-81`): the reply must start with `Slug:` or be the no-items sentinel; anything else is `off-contract`, documented as "the agent failing (an error printed with exit 0), not a bad draft". A failure of either kind aborts the rest of the Sweep and carries unfinished Sessions over to the next run (`src/sweep.ts:68-73`).

**Test seam** (`src/drafting.ts:16-17, 59-60`): `BRAIN_DUMP_DRAFT_AGENT` replaces the command with `sh -c <value>`, so tests stub the agent.

**Why `--safe-mode`, not `--bare`:** `--bare` "skip[s] ... keychain reads" and makes Anthropic auth "strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` ... (OAuth and keychain are never read)" (`claude --help`, captured 2026-10-26). `--safe-mode` disables customizations (CLAUDE.md, skills, plugins, hooks, MCP servers, auto memory) but "Authentication, model selection, built-in tools, and permissions work normally, which differs from `--bare`" ([CLI reference](https://code.claude.com/docs/en/cli-reference), `--safe-mode`). A subscription login in the keychain therefore needs `--safe-mode`.

**The launchd plist** (`install.sh:113-165`, function `offer_launchd_timer`; the installed copy is `~/Library/LaunchAgents/com.brain-dump.sweep.plist`, read only here):

| Key | Value | Source |
| --- | --- | --- |
| `Label` | `com.brain-dump.sweep` | `install.sh:115` |
| `ProgramArguments` | `[<brain-dump>, "sweep"]` | `install.sh:136-139` |
| `EnvironmentVariables` | only `PATH`, copied from the installing shell | `install.sh:140-144`; comment at `:113`: "The launchd agent has no login shell, so it gets this shell's PATH to find bun and claude." |
| `StartCalendarInterval` | `Hour 4, Minute 0` | `install.sh:145-151` |
| `StandardOutPath` / `StandardErrorPath` | `/dev/null` / `~/.local/state/brain-dump/sweep.log` | `install.sh:152-155` |
| Loaded with | `launchctl bootstrap gui/$(id -u) <plist>` | `install.sh:115, 159` |
| Removal | `launchctl bootout gui/$(id -u)/com.brain-dump.sweep` | `install.sh:117` |

Per `install.sh:124` it "runs at 04:00 on this machine, or when it wakes if it was asleep then". No `UserName` is needed: `launchd.plist(5)` says that key is "only applicable for services that are loaded into the privileged system domain".

**Evidence it works unattended:** the installed agent's 04:00 run on 2026-10-26 (`~/.local/state/brain-dump/sweep.json`, `last.time` 08:00:02Z) drafted 25 Dumps through `claude -p`. Its only error was a downstream write gate (`write refused: the plan writes 25 notes, more than 8, so it needs confirmLarge`), not an agent failure. One earlier run on 2026-10-20 crashed with `EDEADLK` while reading a Vault file (`sweep.log`), which is a Vault filesystem issue, not an auth one. It shows the log captures stderr from crashes.

## 2. `claude -p`

### Auth when unattended

- **Credential store:** on macOS "credentials are stored in the encrypted macOS Keychain". If the Keychain rejects the write (e.g. locked in an SSH session), Claude Code falls back to `~/.claude/.credentials.json` mode 0600. `CLAUDE_CONFIG_DIR` changes both the file location and the Keychain entry ([Authentication, Credential management](https://code.claude.com/docs/en/authentication#credential-management)). This Mac has no `.credentials.json`, so the login is in the Keychain; `claude auth status` reports `claude.ai`, `subscriptionType: pro`.
- **Why launchd works:** Brain-Dump bootstraps into `gui/$(id -u)` (`install.sh:115, 159`), the logged-in user's GUI domain, which is the session that can read the login Keychain. Consequence: the Mac mini must have the user logged in (auto-login) and the Keychain unlocked. A fresh reboot with no login would leave the agent unloaded or unable to read the Keychain. This inference follows from the domain choice and the docs above; it was not tested (see Open items).
- **Token expiry:** the saved login is refreshed automatically. If the OAuth service rejects the refresh token, Claude Code clears the credentials and every request fails; in `-p` the message is `Failed to authenticate: OAuth session expired and could not be refreshed` (error code `authentication_failed`) ([Errors, Login expired](https://code.claude.com/docs/en/errors#login-expired)). Claude Code warns at startup 3 days before a login expires, but only in interactive use ([Authentication, Renew an expiring login](https://code.claude.com/docs/en/authentication#renew-an-expiring-login)); a headless run gets no such warning, so a failed run is the first sign.
- **Non-interactive alternatives:** `claude setup-token` makes a one-year OAuth token for `CLAUDE_CODE_OAUTH_TOKEN` (needs Pro/Max/Team/Enterprise; "does not save the token anywhere"). Sessions using it "never see" the Login expired message, but an expired or revoked token gives `Failed to authenticate. API Error: 401 OAuth token has expired` ([Authentication, Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token); [Errors](https://code.claude.com/docs/en/errors#login-expired)). `--bare` ignores it. Not needed while the Keychain path works; it is the fallback if the Keychain proves unreliable.
- **Precedence trap:** "In non-interactive mode (`-p`), the key is always used when present" for `ANTHROPIC_API_KEY`, and it outranks the subscription login. Do not export `ANTHROPIC_API_KEY` into the plist unless intending API billing ([Authentication, precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)).

### PATH and environment

- launchd gives a bare environment; `launchd.plist(5)` documents only `EnvironmentVariables` as the way to add variables (`man launchd.plist`, `EnvironmentVariables` entry). It does not list the default variables, so which ones launchd sets for a user agent is not documented there.
- Brain-Dump sets only `PATH` (copied from the installing shell) and works (section 1). That PATH holds `~/.local/bin` (where `claude` lives; `command -v claude` here gives `/Users/kali/.local/bin/claude`) and the bun path.
- **Observed, 2026-10-26, same Mac, with `env -i` to strip the environment:**

| Environment passed | Result |
| --- | --- |
| `HOME`, `PATH` | exit 1; stdout JSON `is_error: true`, `result: "Not logged in · Please run /login"`, `total_cost_usd: 0` |
| `HOME`, `PATH`, `USER`, `LOGNAME` | success, `result: "ok"` |
| `HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR` | success |

  My probes ran as a child of a Claude Code agent, not as a launchd job, so this proves the Keychain lookup is sensitive to `USER`/`LOGNAME`, not what launchd supplies. Brain-Dump's job works with only `PATH` set explicitly, which suggests launchd supplies them. To be safe, set `HOME`, `USER`, `LOGNAME` and `PATH` explicitly in the plist; it costs nothing. (Verify once with a first run; see Open items.)
- Set `cwd` to a neutral directory. Brain-Dump uses `homedir()` (`src/drafting.ts:62`). Without `--bare`/`--safe-mode`, `-p` loads project settings, hooks and `.mcp.json` even in untrusted folders ([Headless](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)).

### Flags for a pure text-in/text-out call (no tools, no saved transcript)

From `claude --help` (2.1.311, captured to the scratchpad) and the [CLI reference](https://code.claude.com/docs/en/cli-reference):

| Flag | Effect |
| --- | --- |
| `-p`, `--print` | Non-interactive; reads the prompt from stdin if not given as an argument ([Headless, Pipe data](https://code.claude.com/docs/en/headless#pipe-data-through-claude); piped stdin capped at 10MB). Skips the workspace trust dialog. |
| `--tools ""` | "Use `""` to disable all" built-in tools. "The flag doesn't affect MCP tools". |
| `--strict-mcp-config` | Only MCP servers from `--mcp-config`; with no `--mcp-config` that means none. |
| `--safe-mode` | Disables CLAUDE.md, skills, plugins, hooks, MCP servers, auto memory, etc. Keeps auth and model selection. |
| `--no-session-persistence` | "sessions are not saved to disk and cannot be resumed (only works with --print)". |
| `--model <alias or full id>` | See Model selection. |
| `--permission-prompts none` | Anything that would prompt is denied. Redundant with no tools; harmless belt-and-braces. |
| `--max-turns N` | Print mode only; exits with an error at the limit. |
| `--max-budget-usd N` | Print mode only; client-side estimate, can be overshot. |
| `--system-prompt` / `--append-system-prompt` | Replace or extend the system prompt. |

Observed, `claude-sonnet-5-5`, `cwd=$HOME`: this exact set (plus `--output-format json`) returned `result: "ok"`, `is_error: false`, `terminal_reason: "completed"`, cost about $0.0006 to $0.015 per trivial call (first call is the uncached one).

### Structured / JSON output

- `--output-format text|json|stream-json` ([Headless, Get structured output](https://code.claude.com/docs/en/headless#get-structured-output)). `json` gives a single result object: `result` (text), `is_error`, `subtype`, `terminal_reason`, `num_turns`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, etc. (observed keys, 2.1.311).
- `--json-schema '<schema>'` with `--output-format json`: "The response includes metadata ... with the structured output in the `structured_output` field." If the run ends without valid structured output "the response has no `structured_output` field", so check presence. `format` is treated as an annotation, not enforced. An invalid schema exits with `Error: --json-schema is not a valid JSON Schema` ([Headless](https://code.claude.com/docs/en/headless#get-structured-output)).
- Observed: `--tools "" --safe-mode --json-schema '{...answer: string...}' --output-format json` returned exit 0, `structured_output: {"answer":"ok"}`, `num_turns: 2`, about $0.0066. So the schema path works with all tools disabled.
- Brain-Dump does not use JSON; it parses a plain-text contract (`Slug:` first line) at `src/drafting.ts:73-81`. For Briefings, plain Markdown on stdout needs no schema. If the Briefing needs metadata (e.g. which **Picks** were written up), use `--json-schema` with `structured_output`.

### Model selection

- `--model` takes an alias (`sonnet`, `opus`, `fable`, `haiku`) or a full name. "Aliases point to the recommended version ... and update over time. To pin to a specific version, use the full model name" ([Model configuration](https://code.claude.com/docs/en/model-config#pinning-full-model-names)). Brain-Dump pins `claude-sonnet-5-5` (`src/drafting.ts:14`) so output does not drift.
- With no `--model`, Pro/Max/Team/Enterprise default to Opus 5.5 ([Model configuration, default model](https://code.claude.com/docs/en/model-config#default-model-for-your-subscription)). Always pass `--model` in a scheduled job.
- `--effort low|medium|high|xhigh|max` exists; default is `medium` on Sonnet 5.5 (same page, Effort levels). `--fallback-model` swaps models when the primary is overloaded or unavailable, but "Authentication, billing, rate-limit ... errors never trigger a switch".
- An unknown model id fails fast: observed exit 1, stdout JSON with `is_error: true`, `total_cost_usd: 0`, stderr line `[claude-code:unrecognized_model]`.

### Timeouts and exit codes

- No timeout flag. Brain-Dump wraps the process with a 10 minute timeout (`src/drafting.ts:11, 62`). `Bun.spawnSync` timeout leaves `exitCode === null`, which Brain-Dump reports as "timed out" (`src/drafting.ts:65`).
- Documented: "exits with code 0 on success and a non-zero code when the run fails ... When a failure happens inside the run, such as missing authentication, Claude Code prints the failure as the result on stdout." Invalid flags go to stderr before the run starts ([Headless](https://code.claude.com/docs/en/headless#basic-usage)).
- SIGTERM exits 143 and leaves the turn unfinished ([Headless, Stop a run with SIGTERM](https://code.claude.com/docs/en/headless#stop-a-run-with-sigterm)). launchd sends SIGTERM then SIGKILL after `ExitTimeOut` (`man launchd.plist`).
- Observed exit codes: 1 for not-logged-in and for an unknown model. In both, `is_error` was `true` and `subtype` was still `"success"`. Gate on exit status **and** `is_error`; do not rely on `subtype`. Brain-Dump's "error printed with exit 0" guard (`src/drafting.ts:22`) covers a case I did not reproduce in 2.1.311, so keep an equivalent output-shape check.
- Retries: transient 429/529 are retried up to 10 times with backoff before failing ([Errors, API retries](https://code.claude.com/docs/en/errors)). `CLAUDE_CODE_RETRY_WATCHDOG=1` retries "indefinitely" in unattended sessions; leave it unset for a timeout-bounded daily job.

### Usage and rate limits for a few calls a day

- On a subscription, `-p` usage counts against the plan's rolling 5-hour session and weekly allowances, shared across models. Hitting one gives `You've hit your session limit · resets 3:45pm` or `... weekly limit · resets Mon 12:00am`; "Claude Code blocks further requests until the reset time" ([Errors, usage limit](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit)). The page does not say what exit code `-p` returns for this; treat as a failed run.
- A Briefing call is one request of modest size. Observed trivial calls cost roughly $0.001 to $0.015 at list price (client-side estimates, "not authoritative billing data": [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)). Brain-Dump's Sweep, which does up to 25 Sessions of up to 150k characters (`src/drafting.ts:10`, `src/sweep.ts:23`) in one go, runs fine on the same plan, so one Daily Briefing plus a Weekly Briefing is far lighter.
- `--output-format json` returns `total_cost_usd`, useful for logging per-run spend.

## 3. `codex exec`

### Auth when unattended

- By default `codex exec` "reuses saved CLI authentication" ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), redirected from developers.openai.com/codex/noninteractive).
- **Storage:** credentials cache "in a plaintext file at `~/.codex/auth.json` or in your OS-specific credential store". `cli_auth_credentials_store` is `file`, `keyring` (fails if unavailable), `auto` (keyring if available, else file) or `ephemeral` ([Auth](https://learn.chatgpt.com/docs/auth)). On this Mac `~/.codex/auth.json` exists and `~/.codex/config.toml` has no `cli_auth_credentials_store`, so it is file storage. That makes it independent of Keychain lock state, unlike Claude.
- **Probe:** `codex exec` ran successfully under `env -i HOME=… PATH=…` only. The stderr header showed `provider: openai`, and the error text for a bad model names "Codex with a ChatGPT account", so the login is ChatGPT-managed (subscription), not an API key.
- **Refresh and expiry:** "Codex refreshes tokens automatically during use before they expire." The page gives no token lifetime ([Auth](https://learn.chatgpt.com/docs/auth)). A daily run keeps refreshing the file in place. Because refresh rewrites `auth.json`, do not run a second copy of the file elsewhere that refreshes independently.
- **What OpenAI recommends:** "API keys are the right default for automation"; ChatGPT-managed auth is "advanced", for trusted runners, and the file should be treated "like a password" ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). `CODEX_API_KEY` is set inline per invocation. Here a private personal Mac running a private job fits the "trusted runner" case and uses the existing ChatGPT plan allowance.
- Headless re-login if it expires: `codex login --device-auth` (beta) or copy `~/.codex/auth.json` from a machine with a browser ([Auth](https://learn.chatgpt.com/docs/auth)).

### PATH and environment

- The binary is `/Users/kali/.nvm/versions/node/v24.14.0/bin/codex`, a Node/nvm path. launchd does not source shell profiles, so `nvm` is not active. Put that bin dir on the plist `PATH`, or call the absolute path. Brain-Dump's approach (copy the installing shell's `PATH`, `install.sh:113, 143`) covers this if paper-bot installs from the same shell. An nvm upgrade changes that path, so prefer a stable symlink or re-run the install.
- Observed: ran with `env -i HOME="$HOME" PATH="/usr/bin:/bin:<nvm bin>"` and succeeded. `codex` reads `$CODEX_HOME` (default `~/.codex`), so `HOME` must be set.
- Config comes from `~/.codex/config.toml` (`model = "gpt-6.1-sol"`, `model_reasoning_effort = "medium"`). `--ignore-user-config` skips it (auth still uses `CODEX_HOME`), after which `-m` must be passed.
- Observed side effect: user hooks configured in `~/.codex` ran (stderr showed `hook: SessionStart ... Failed`, `hook: Stop`) and the run still exited 0. `--ignore-user-config` would avoid them if they matter.

### Flags for a pure text-in/text-out call

From `codex exec --help` (codex-cli 0.164.0) and [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode):

| Flag | Effect |
| --- | --- |
| `[PROMPT]` or `-` | "If not provided as an argument (or if `-` is used), instructions are read from stdin." A piped stdin with an argument prompt is appended as a `<stdin>` block. |
| `-s read-only` | Sandbox for model-generated shell commands. "By default, `codex exec` runs in a read-only sandbox." |
| `--ephemeral` | "Run without persisting session files to disk." |
| `--skip-git-repo-check` | Required outside a Git repo: "Codex requires commands to run inside a Git repository". |
| `-C <dir>` | Working root. |
| `--output-schema <file>` | JSON Schema for the final message. |
| `-o <file>` | Writes the last message to a file; it is also printed. |
| `--json` | stdout becomes a JSONL event stream. |
| `--ignore-user-config`, `--ignore-rules` | Skip `config.toml` and execpolicy rules. |
| `-m <model>` | Model override. |

- **There is no flag to remove the tool set.** `read-only` limits what shell commands can do, but the agent can still read files and run commands. For a ranking call, tell the model in the prompt to answer from the supplied abstracts only, and run from a neutral directory. A truly tool-less call is not available in `codex exec`; this is a gap versus `claude --tools ""`. (Not found in `--help` or the docs; I did not search the config reference for a tools-disable key.)
- Output: "Progress goes to stderr, and only the final message goes to stdout" (default mode), so stdout is directly capturable. Observed: stdout `{"answer":"ok"}`, same text in the `-o` file, a header plus hook lines and `tokens used 22,734` on stderr. The 22,734 tokens for a trivial prompt reflects the default system prompt and tool definitions.

### Structured / JSON output

- `--output-schema ./schema.json` "request[s] a final response that conforms to a JSON Schema" ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). Observed with `{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}`: exit 0, stdout and `-o` file both `{"answer":"ok"}`. I included `additionalProperties:false` and listed all properties in `required`, the shape OpenAI structured outputs require; whether a looser schema is rejected was not tested.
- `--json` is for event streams (`thread.started`, `turn.completed`, `turn.failed`, `error`, `item.*`), not for the schema result. For ranking, use `--output-schema` plus `-o` and read the file, or read stdout.

### Model selection

- Default from `~/.codex/config.toml`: `model = "gpt-6.1-sol"`. Observed in the stderr header: `model: gpt-6.1-sol`, `provider: openai`, `reasoning effort: medium`. `-m` or `-c model="…"` overrides per run.
- Observed: an unknown model fails with exit 1 and `ERROR: {"type":"error","status":400,… "The 'nonexistent-model-xyz' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}` on stderr. Model choice is also limited by the account type: ChatGPT-plan logins accept only models offered to that plan.
- Pass `-m gpt-6.1-sol` explicitly in the job so a config edit does not change the ranker silently.

### Timeouts and exit codes

- No timeout flag. Wrap with a timeout the way Brain-Dump does (`src/drafting.ts:62`).
- The docs "do not document exit codes"; the only stated failure is that a `required = true` MCP server that fails to initialise makes `codex exec` "exit with an error" ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). Observed: exit 0 on success, exit 1 on a rejected model, with the error on stderr. Treat any non-zero exit as failure. Also validate the output is parseable against the schema, since a zero exit does not by itself prove a valid answer.

### Usage and rate limits

- API-key use is "billed at API rates rather than against plan allowances". ChatGPT-login use shares the plan allowance: "Local messages and cloud chats share your plan's usage allowance"; on Plus the doc estimates 15-160 local messages per five-hour window for GPT-6.1 Sol, "Pro plans currently have no five-hour limit", and weekly limits may also apply ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). The page does not state whether `codex exec` runs are counted differently from interactive messages. One ranking call per day (or one per batch of abstracts) is far below these figures. The plan tier on this Mac was not checked.
- Trivial call here consumed 22,734 tokens, so batch many abstracts into one call rather than one call per **Paper**.

## 4. Recommended invocations

Both read the prompt on stdin, run from a neutral directory, and are wrapped by the caller with a timeout and exit-status plus output validation. Use argv arrays in code, not shell strings.

### Briefing writer: `claude -p`

```sh
cd "$HOME" && claude -p \
  --no-session-persistence \
  --model claude-sonnet-5-5 \
  --tools "" \
  --strict-mcp-config \
  --safe-mode \
  --output-format json \
  --json-schema "$SCHEMA"        # omit both JSON flags to get Markdown on stdout
```

- Identical to Brain-Dump's `DRAFTING_COMMAND` (`src/drafting.ts:15`) plus optional JSON flags (the combination was probed).
- Success test: exit 0, `is_error === false`, and (with the schema) `structured_output` present. Plain-text mode: exit 0 and a reply matching the Briefing contract.
- Timeout: 10 minutes is Brain-Dump's value; a single Briefing should need far less. On timeout, `exitCode === null` under Bun.
- Pin the model by full id, as Brain-Dump does. `claude-sonnet-5-5` is what Brain-Dump pins; picking a different model is a separate decision.
- Do not pass `--bare` (no Keychain) and do not set `ANTHROPIC_API_KEY`.

### Abstract ranker: `codex exec`

```sh
cd "$HOME" && codex exec \
  --ephemeral \
  -s read-only \
  --skip-git-repo-check \
  -m gpt-6.1-sol \
  --output-schema "$SCHEMA_FILE" \
  -o "$OUT_FILE" \
  -        # prompt on stdin
```

- Read the result from `$OUT_FILE` (or stdout), parse JSON, validate against the schema again in code.
- Write the schema and output to a per-run temp directory owned by paper-bot.
- Add `--ignore-user-config` only if `~/.codex` hooks or config interfere; then keep `-m` explicit.
- Tell the prompt to use only the abstracts given. `codex exec` cannot be made tool-less (see above), and the default token overhead is about 22k tokens per call.

### launchd plist (modelled on Brain-Dump's)

Same shape as `install.sh:128-157`: `Label`, `ProgramArguments`, `EnvironmentVariables`, a `StartCalendarInterval`, `StandardOutPath`/`StandardErrorPath` to a state-folder log, and loaded with `launchctl bootstrap gui/$(id -u)`. Differences:

- `EnvironmentVariables`: `PATH` (must include `~/.local/bin` for `claude` and the nvm bin dir for `codex`), plus `HOME`, `USER`, `LOGNAME`.
- Keep the user logged in (auto-login) so the `gui/<uid>` domain and Keychain exist.
- Missed runs: Brain-Dump relies on launchd running a `StartCalendarInterval` job "when it wakes if it was asleep then" (`install.sh:124`) and on the next Sweep catching up; paper-bot's Briefings need their own catch-up rule.

## Open items (not resolved by this research)

1. **Default launchd environment.** `launchd.plist(5)` does not list what launchd sets for user agents, and my probes were not launchd jobs. Brain-Dump's 04:00 job evidence suggests `USER`/`LOGNAME` are present, but a first paper-bot run should log `env` keys (names only) to confirm.
2. **Keychain at boot.** Whether a headless Mac mini reboot without a GUI login leaves `claude` unable to authenticate (and `codex` unaffected) was not tested. Mitigations: auto-login, or `claude setup-token` with `CLAUDE_CODE_OAUTH_TOKEN` in the plist (stored plaintext in the plist, so file permissions matter).
3. **Usage-limit exit code.** The `-p` exit status when a subscription session or weekly limit is hit is not documented and was not triggered.
4. **Tool-less Codex.** No documented `codex exec` equivalent of `--tools ""` was found; confirm in the Codex config reference if strict isolation matters.
5. **Auth refresh failures.** Neither runner's expiry can be forecast: Claude's docs give no refresh-token lifetime, and Codex's page "doesn't state specific token lifetimes". Alert on the first failed run (non-zero exit plus stderr/`result` text).

## Probe log (2026-10-26, this Mac)

Model calls made: 4 billed `claude -p` calls (three single-word, one schema) and 1 billed `codex exec`, plus 4 calls that failed before any billing (two `claude -p` Not logged in / unknown model, one `codex exec` unknown model). That is more `claude -p` calls than the single trivial call planned, because the first call exposed the `USER`/`LOGNAME` issue and the follow-ups bisected it and checked `--json-schema` with `--tools ""`. Raw outputs were kept in the session scratchpad, not committed.
