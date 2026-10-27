import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exec, CommandResult } from "../src/command.ts";
import type { Config } from "../src/config.ts";
import type { Fetch } from "../src/http.ts";
import { INTERESTS_NOTE } from "../src/interests.ts";

export const ARXIV_FEED = readFileSync(join(import.meta.dir, "fixtures", "arxiv-rss.xml"), "utf8");

export const INTERESTS = `# Interests

## AI in higher education
How AI changes university teaching and assessment.

## Context management in AI
How agents choose, compress and carry context.

## Wildcards
Up to 1 per Daily Briefing.
`;

/** Noon UTC, so the local date is 26 Oct in any zone the tests run in. */
export const MONDAY = new Date("2026-10-26T12:00:00Z");

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    models: { rank: "gpt-test", write: "claude-test" },
    brainDump: "brain-dump",
    arxiv: { categories: ["cs.AI", "cs.CL", "cs.HC"] },
    venues: {},
    bars: { pick: 7, wildcard: 8 },
    batch: { size: 100, cap: 20 },
    ...overrides,
  };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "paper-bot-test-"));
}

/** An arXiv RSS feed of `count` new Papers, ids `2610.30001` onward. */
export function arxivFeedOf(count: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const id = `2610.${30001 + i}`;
    return `<item><title>Paper ${i + 1}</title><link>https://arxiv.org/abs/${id}</link><description>arXiv:${id}v1 Announce Type: new
Abstract: Abstract ${i + 1}.</description><arxiv:announce_type>new</arxiv:announce_type></item>`;
  });
  return `<?xml version='1.0' encoding='UTF-8'?><rss version="2.0"><channel>${items.join("\n")}</channel></rss>`;
}

export function arxivFetch(feed = ARXIV_FEED): Fetch & { urls: string[] } {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return new Response(feed);
  };
  return Object.assign(fetch, { urls });
}

export type FakeRanking = { score: number; interests?: string[]; why?: string; wildcard?: boolean };
type Handler = (argv: string[], stdin: string) => CommandResult;

export type FakeCommands = {
  exec: Exec;
  /** Every command line run, in order, with what it was given on stdin. */
  calls: { argv: string[]; stdin: string }[];
  /** The fake Vault behind `brain-dump`: Vault-relative path to note text. */
  vault: Map<string, string>;
};

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const failed = (stderr: string): CommandResult => ({ exitCode: 1, stdout: "", stderr });

/** The ids of the Candidates a prompt names, in order. */
export const idsIn = (prompt: string): string[] => [...new Set(prompt.match(/arxiv:\d{4}\.\d{4,5}/g))];

/**
 * Fake `codex`, `claude` and `brain-dump`. `codex` scores each Candidate from `rankings` (unlisted ones score 0),
 * `claude` writes fixed prose for each Pick or Keep, and `brain-dump` serves and writes notes and Dumps in `vault`.
 */
export function fakeCommands(
  options: {
    rankings?: Record<string, FakeRanking>;
    notes?: Record<string, string>;
    codex?: Handler;
    claude?: Handler;
    brainDump?: Handler;
    writeDump?: Handler;
  } = {},
): FakeCommands {
  const vault = new Map(Object.entries(options.notes ?? { [INTERESTS_NOTE]: INTERESTS }));
  const calls: FakeCommands["calls"] = [];

  const codex: Handler = (_argv, stdin) =>
    ok(
      JSON.stringify({
        rankings: idsIn(stdin).map((id) => {
          const ranking = options.rankings?.[id] ?? { score: 0 };
          return { id, interests: ranking.interests ?? [], score: ranking.score, why: ranking.why ?? `ranked ${id}`, wildcard: ranking.wildcard ?? false };
        }),
      }),
    );

  const claude: Handler = (argv, stdin) =>
    ok(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: argv.some((arg) => arg.includes('"learnings"'))
          ? { header: `Header of ${idsIn(stdin)[0]}`, learnings: [`First Learning of ${idsIn(stdin)[0]}`, `Second Learning of ${idsIn(stdin)[0]}`] }
          : {
              take: "Today leans toward context.",
              picks: idsIn(stdin).map((id) => ({ id, why: `Why ${id}.`, summary: `What ${id} found.` })),
            },
      }),
    );

  const brainDump: Handler = (argv, stdin) => {
    const [, command, ...rest] = argv;
    if (command === "show") {
      const note = rest.find((arg) => !arg.startsWith("--")) ?? "";
      const text = vault.get(note);
      if (text === undefined) return failed(`brain-dump: ${note} is not a note in the write allowlist\n`);
      return ok(JSON.stringify({ note, hash: "0123456789abcdef", text, truncated: false }));
    }
    if (command === "write-briefing" && rest[0] === "--note" && rest[1] !== undefined) {
      if (vault.has(rest[1])) return failed(`brain-dump: ${rest[1]} already exists\n`);
      vault.set(rest[1], stdin);
      return ok(JSON.stringify({ note: rest[1], run: "r-1" }));
    }
    if (command === "write-dump") return (options.writeDump ?? writeDump)(argv, stdin);
    return { exitCode: 2, stdout: "", stderr: `brain-dump: unknown ${command}\n` };
  };

  const writeDump: Handler = (argv, stdin) => {
    const flag = (name: string): string | undefined => argv[argv.indexOf(name) + 1];
    const path = `Inbox/2026-10-27 0600 ${flag("--project")} - ${flag("--slug")}.md`;
    vault.set(path, stdin);
    return ok(`${path}\n`);
  };

  const handlers: Record<string, Handler> = {
    codex: options.codex ?? codex,
    claude: options.claude ?? claude,
    "brain-dump": options.brainDump ?? brainDump,
  };

  const exec: Exec = async (argv, { stdin = "" }) => {
    calls.push({ argv, stdin });
    const handler = handlers[argv[0] ?? ""];
    if (handler === undefined) throw new Error(`no fake for ${argv[0]}`);
    return handler(argv, stdin);
  };
  return { exec, calls, vault };
}
