# Setting up paper-bot on the Mac mini

Steps 1–3 of #33: the config, the Interests Note, and the schedule. Work in the checkout launchd will use, on `main`, logged in to the Mac as yourself.

## 0. Before you start

```sh
cd ~/Projects/bot && git pull && bun install
which codex claude brain-dump bun     # all four must resolve; with nvm, `nvm use` first
```

`codex` and `claude` must both be logged in. `brain-dump` must be a version with `write-briefing` and `write-dump --origin briefing` (Brain-Dump#126, #127).

## 1. Config and OpenAlex key

1. Sign up at openalex.org, then open Settings → API key and copy the key. It's free.
2. Create the config from the example and make it private. paper-bot refuses a config other users can read:

   ```sh
   mkdir -p ~/.config/paper-bot
   cp config.example.json ~/.config/paper-bot/config.json
   chmod 600 ~/.config/paper-bot/config.json
   ```

3. In `~/.config/paper-bot/config.json`, replace the placeholder in `openalex.key` with your key. The other fields can stay as they are; the README's Setup section explains each one.
4. Check that the key works. This reads the config and asks OpenAlex, and writes nothing:

   ```sh
   bun src/cli.ts author "Kenneth Koedinger"
   ```

   You should get a list of author records. `cannot read the config` or `readable by other users` means step 2 needs redoing. An OpenAlex error means the key is wrong.

## 2. The Interests Note

1. In Obsidian, create `Research/Briefings/Interests.md` and paste in the whole of `docs/drafts/Interests.md`. paper-bot only ever reads this Vault note; editing the draft in the repo changes nothing.
2. Edit it in your own words. The format:
   - each `## <Interest>` heading is one Interest, followed by a paragraph describing it;
   - optional `- Venues: A, B` and `- Avoid: x; y` bullets under it (Venues separated by commas, Avoid items by semicolons);
   - `## Wildcards` holding "Up to N per Daily Briefing";
   - `## Followed Groups`, one bullet per group: `- Koedinger lab: Kenneth Koedinger (A5012345678); Vincent Aleven (A5087654321)`. Find members' ids with `bun src/cli.ts author "<name>"`, and list every id that is theirs, since OpenAlex sometimes splits one person across several. Leave the section empty, or delete it, to follow no groups.
3. Decide what to do about **AIED** and **EDM**. The starter note lists them as Venues, but the config has no OpenAlex source for either. They still reach ranking, but every Briefing will report them as unknown Venues. Either:
   - add their OpenAlex source ids to `venues` in the config. Search `https://api.openalex.org/sources?search=<name>` and use the `S…` id. AIED appears in OpenAlex as yearly Springer proceedings, so it may have no single source; or
   - remove them from the note's `- Venues:` line.
4. Check that paper-bot can read the note through Brain-Dump:

   ```sh
   brain-dump show Research/Briefings/Interests.md --full
   ```

## 3. The schedule

1. Start one Daily Scan by hand first, so problems show up in your terminal and not in a log at 06:00:

   ```sh
   bun src/cli.ts scan --daily
   ```

   It fetches, ranks and writes today's Daily Briefing to `Research/Briefings/Daily/`, or reports that the Scan was skipped. A first Scan ranks a lot of Candidates, so expect it to take a while. Read the Briefing's footer. It should name no failed sources, and no Interests Note issues you didn't expect. It exits 1 when the Scan failed, and prints why.
2. Install the LaunchAgent from this checkout, in a shell where `codex` is on PATH (with nvm, after `nvm use`):

   ```sh
   bun scripts/install-launch-agent.ts
   launchctl print gui/$(id -u)/dev.paper-bot.scan | grep -E "state|runs"
   ```

   It should print `installed …/dev.paper-bot.scan.plist`, and `launchctl print` should show the agent loaded.
3. The next morning, check that the 06:00 Scan wrote a Daily Briefing or recorded a skip:

   ```sh
   ls ~/Library/Logs/paper-bot/
   tail -n 20 ~/Library/Logs/paper-bot/launchd.out.log    # how each Scan settled
   cat ~/Library/Logs/paper-bot/launchd.err.log           # empty when nothing failed
   ```

   The Mac must be on, and you logged in, at 06:00. `claude` reads its login from the Keychain. If the Mac was asleep, the Scan starts when it wakes.

If you'd rather not wait for 06:00, `launchctl kickstart gui/$(id -u)/dev.paper-bot.scan` starts a Scan through launchd now. Since step 3.1 already wrote today's Daily Briefing, this Scan only reports it as already written, then records last week's Weekly Scan as skipped, because that week has no Picks. That still shows that launchd can start paper-bot with a working PATH.

## When something fails

| Symptom | Fix |
| --- | --- |
| `cannot start codex` in `launchd.err.log` | nvm moved Node. Run `nvm use` and install again (step 3.2). Do the same after moving the checkout or reinstalling bun. |
| `Not logged in` from `claude` | Log in to the Mac itself. Over ssh alone, `claude` can't read the Keychain. |
| A `brain-dump show` error, or `Research/Briefings/Interests.md lists no Interests` | The Vault note's path must be exactly `Research/Briefings/Interests.md`, with at least one `## <Interest>` heading. |
| `openalex` listed as a failed source in the footer | Check the key (step 1.4). The other sources still feed the Briefing. |

To uninstall the schedule: `launchctl bootout gui/$(id -u)/dev.paper-bot.scan && rm ~/Library/LaunchAgents/dev.paper-bot.scan.plist`.
