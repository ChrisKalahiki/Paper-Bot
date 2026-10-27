import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

// `bun scripts/install-launch-agent.ts`: fills in the LaunchAgent template from this shell and checkout, and loads it into launchd.

const LABEL = "dev.paper-bot.scan";
const REPO = join(import.meta.dir, "..");
export const LAUNCH_AGENT_TEMPLATE = join(REPO, "launchd", `${LABEL}.plist`);

export type LaunchAgentValues = {
  /** The bun binary that runs `src/cli.ts`. */
  bun: string;
  /** The paper-bot checkout. */
  repo: string;
  home: string;
  user: string;
  /** The folder holding `codex`, under nvm, so its `node` is found too. */
  codexDir: string;
};

export function fillLaunchAgent(values: LaunchAgentValues): string {
  const placeholders: Record<string, string> = {
    __BUN_DIR__: dirname(values.bun),
    __BUN__: values.bun,
    __REPO__: values.repo,
    __HOME__: values.home,
    __USER__: values.user,
    __CODEX_DIR__: values.codexDir,
  };
  return Object.entries(placeholders).reduce(
    (text, [placeholder, value]) => text.replaceAll(placeholder, escapeXml(value)),
    readFileSync(LAUNCH_AGENT_TEMPLATE, "utf8"),
  );
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function install(): number {
  const codex = Bun.which("codex");
  if (codex === null) {
    process.stderr.write("install-launch-agent: codex is not on PATH; load nvm (or install codex) in this shell and run this again\n");
    return 1;
  }
  const home = homedir();
  const user = userInfo().username;
  const plist = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  mkdirSync(join(home, "Library", "Logs", "paper-bot"), { recursive: true });
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, fillLaunchAgent({ bun: process.execPath, repo: REPO, home, user, codexDir: dirname(codex) }));

  const domain = `gui/${userInfo().uid}`;
  // Unloads an earlier install so the new plist takes effect; fails harmlessly when none is loaded.
  Bun.spawnSync(["launchctl", "bootout", `${domain}/${LABEL}`], { stdout: "ignore", stderr: "ignore" });
  const loaded = Bun.spawnSync(["launchctl", "bootstrap", domain, plist], { stdout: "inherit", stderr: "inherit" });
  if (loaded.exitCode !== 0) {
    process.stderr.write(`install-launch-agent: launchctl could not load ${plist}; try again, or see README "Schedule"\n`);
    return 1;
  }
  process.stdout.write(`installed ${plist}: paper-bot scan starts daily at 06:00, logging to ~/Library/Logs/paper-bot\n`);
  return 0;
}

if (import.meta.main) process.exitCode = install();
