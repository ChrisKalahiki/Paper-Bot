import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lastWeek, localDate } from "../src/clock.ts";
import { parseConfig } from "../src/config.ts";
import { openStore } from "../src/store.ts";
import { tempDir, testConfig } from "./harness.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");
const USAGE = 'paper-bot: usage: paper-bot scan [--daily | --weekly]\n       paper-bot picks --json\n       paper-bot author "<name>"\n';

type Home = { home: string; configPath: string; storePath: string };

function home(): Home {
  const home = tempDir();
  return { home, configPath: join(home, ".config", "paper-bot", "config.json"), storePath: join(home, "paper-bot.db") };
}

function writeConfig({ configPath }: Home, config: unknown, mode = 0o600): void {
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config));
  chmodSync(configPath, mode);
}

/** A stand-in `brain-dump` that cannot reach the Vault. */
function unreachableBrainDump({ home }: Home): string {
  const path = join(home, "brain-dump");
  writeFileSync(path, "#!/bin/sh\necho 'brain-dump: Vault not found at ~/The Vault' >&2\nexit 1\n");
  chmodSync(path, 0o755);
  return path;
}

function paperBot({ home, storePath }: Home, args: string[]) {
  const result = Bun.spawnSync(["bun", CLI, ...args], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PAPER_BOT_DB: storePath },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("paper-bot scan --daily", () => {
  test("fails naming the config file when there is none", () => {
    // #given
    const sandbox = home();

    // #when
    const result = paperBot(sandbox, ["scan", "--daily"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: `paper-bot: cannot read the config at ${sandbox.configPath}: ENOENT: no such file or directory, stat '${sandbox.configPath}'; start from config.example.json\n`,
    });
  });

  test("refuses a config file other users can read", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, testConfig(), 0o644);

    // #when
    const result = paperBot(sandbox, ["scan", "--daily"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: `paper-bot: ${sandbox.configPath} is readable by other users; make it private with chmod 600 ${sandbox.configPath}\n`,
    });
  });

  test("names the config field that is wrong", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, { ...testConfig(), bars: { pick: 11, wildcard: 8 } });

    // #when
    const result = paperBot(sandbox, ["scan", "--daily"]);

    // #then
    expect(result.stderr).toBe(`paper-bot: ${sandbox.configPath}: bars.pick must be a whole number from 0 to 10\n`);
  });

  test("exits 1 and records the failed Scan and its log when the Vault can't be reached", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, testConfig({ brainDump: unreachableBrainDump(sandbox) }));
    const reason = "brain-dump show failed (exit 1): brain-dump: Vault not found at ~/The Vault";

    // #when
    const result = paperBot(sandbox, ["scan", "--daily"]);

    // #then
    const store = openStore(sandbox.storePath);
    const logDir = join(sandbox.home, "Library", "Logs", "paper-bot");
    const [log = ""] = readdirSync(logDir);
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr,
      scans: store.scans().map(({ outcome, reason }) => ({ outcome, reason })),
      logged: readFileSync(join(logDir, log), "utf8").includes(reason),
    }).toEqual({ exitCode: 1, stderr: `paper-bot: Daily Scan failed: ${reason}\n`, scans: [{ outcome: "failed", reason }], logged: true });
  });

  test("an unknown command is a usage error", () => {
    // #given
    const sandbox = home();

    // #when
    const result = paperBot(sandbox, ["sweep"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: USAGE });
  });

  test("--daily and --weekly together is a usage error", () => {
    // #given
    const sandbox = home();

    // #when
    const result = paperBot(sandbox, ["scan", "--daily", "--weekly"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: USAGE });
  });
});

describe("paper-bot scan --weekly", () => {
  test("runs only last week's Weekly Scan, skipped when the week has no Picks", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, testConfig({ brainDump: unreachableBrainDump(sandbox) }));

    // #when
    const result = paperBot(sandbox, ["scan", "--weekly"]);

    // #then
    const store = openStore(sandbox.storePath);
    expect({
      exitCode: result.exitCode,
      stdout: /^Weekly Scan skipped: no Picks in \d{4}-W\d{2}\n$/.test(result.stdout),
      kinds: store.scans().map(({ kind }) => kind),
    }).toEqual({ exitCode: 0, stdout: true, kinds: ["weekly"] });
  });

  test("reports a Weekly Briefing already written and exits 0, starting no Scan", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, testConfig({ brainDump: unreachableBrainDump(sandbox) }));
    const week = lastWeek(new Date());
    const briefing = `Research/Briefings/Weekly/${week.name} Weekly Briefing.md`;
    const store = openStore(sandbox.storePath);
    store.settleScan(store.startScan("weekly", localDate(week.monday), new Date()), { outcome: "written", briefing, sources: {}, at: new Date() }, []);
    store.close();

    // #when
    const result = paperBot(sandbox, ["scan", "--weekly"]);

    // #then
    const reopened = openStore(sandbox.storePath);
    expect({ exitCode: result.exitCode, stdout: result.stdout, scans: reopened.scans().length }).toEqual({
      exitCode: 0,
      stdout: `Weekly Scan already written: ${briefing}\n`,
      scans: 1,
    });
    reopened.close();
  });
});

describe("paper-bot scan", () => {
  test("still runs the Weekly Scan after a failed Daily Scan, then exits 1 naming the failure", () => {
    // #given
    const sandbox = home();
    writeConfig(sandbox, testConfig({ brainDump: unreachableBrainDump(sandbox) }));

    // #when
    const result = paperBot(sandbox, ["scan"]);

    // #then
    const store = openStore(sandbox.storePath);
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: /^Weekly Scan skipped: no Picks in \d{4}-W\d{2}\n$/.test(result.stdout),
      scans: store.scans().map(({ kind, outcome }) => ({ kind, outcome })),
    }).toEqual({
      exitCode: 1,
      stderr: "paper-bot: Daily Scan failed: brain-dump show failed (exit 1): brain-dump: Vault not found at ~/The Vault\n",
      stdout: true,
      scans: [
        { kind: "daily", outcome: "failed" },
        { kind: "weekly", outcome: "skipped" },
      ],
    });
  });
});

describe("config.example.json", () => {
  test("is a valid config", () => {
    // #given
    const example: unknown = JSON.parse(readFileSync(join(ROOT, "config.example.json"), "utf8"));

    // #when
    const parsing = () => parseConfig(example);

    // #then
    expect(parsing).not.toThrow();
  });

  test("a Venue must map to an OpenAlex source id", () => {
    // #given
    const config = { ...testConfig(), venues: { CHI: "chi" } };

    // #when
    const parsing = () => parseConfig(config);

    // #then
    expect(parsing).toThrow("venues.CHI must be the id of an OpenAlex source, such as S4363607743");
  });

  test("needs the OpenAlex key", () => {
    // #given
    const config = { ...testConfig(), openalex: { key: "" } };

    // #when
    const parsing = () => parseConfig(config);

    // #then
    expect(parsing).toThrow("openalex.key must be a non-empty string");
  });
});

describe("paper-bot author", () => {
  test("with no name is a usage error", () => {
    // #given
    const sandbox = home();

    // #when
    const result = paperBot(sandbox, ["author"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: USAGE });
  });
});
