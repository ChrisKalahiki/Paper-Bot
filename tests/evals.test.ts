import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDaily, checkKeep, checkTopPicks, checkWeekly } from "../evals/assertions.ts";
import type { Ask } from "../evals/claude.ts";
import { dailyEval } from "../evals/daily.ts";
import { EVALS, type Eval, inputHash, staleEvals } from "../evals/eval.ts";
import { type DumpCheck, keepEval, writeDumpDryRun } from "../evals/keep.ts";
import { grade } from "../evals/rubric.ts";
import { weeklyEval } from "../evals/weekly.ts";
import type { CommandResult, Exec } from "../src/command.ts";
import { PaperBotError } from "../src/errors.ts";
import { THEMES_SCHEMA } from "../src/weekly.ts";
import { DAILY_SCHEMA } from "../src/write.ts";
import { tempDir } from "./harness.ts";

describe("prompt evals", () => {
  test("an eval's input hash changes when any input or the model changes, and only then", () => {
    // #given
    const folder = tempDir();
    const [prompt, fixture] = [join(folder, "prompt.md"), join(folder, "fixture.json")];
    writeFileSync(prompt, "Write the take.\n");
    writeFileSync(fixture, "{}\n");
    const declared = { entries: [], inputs: [prompt, fixture], model: "model-a" };
    const before = inputHash(declared);

    // #when
    const unchanged = inputHash(declared);
    writeFileSync(fixture, '{ "picks": [] }\n');
    const fixtureChanged = inputHash(declared);
    const modelChanged = inputHash({ ...declared, model: "model-b" });

    // #then
    expect({ unchanged: unchanged === before, fixtureChanged: fixtureChanged !== before, modelChanged: modelChanged !== fixtureChanged }).toEqual({
      unchanged: true,
      fixtureChanged: true,
      modelChanged: true,
    });
  });

  test.each([
    ["a module the entry imports", "reached.ts", true],
    ["a module the reached module re-exports", "nested.ts", true],
    ["a module imported only for its types", "types.ts", false],
    ["a module nothing imports", "unreached.ts", false],
    ["a declared fixture", "fixture.json", true],
  ])("an eval's input hash follows its entries' imports: editing %s changes it: %p", (_, changed, changes) => {
    // #given
    const folder = tempDir();
    const files: Record<string, string> = {
      "entry.ts": '#!/usr/bin/env bun\nimport { reached } from "./reached.ts";\nimport type { Shape } from "./types.ts";\nimport { readFileSync } from "node:fs";\nexport const write = (shape: Shape) => [reached, shape, readFileSync];\n',
      "reached.ts": 'export { nested } from "./nested.ts";\nexport const reached = 1;\n',
      "nested.ts": "export const nested = 2;\n",
      "types.ts": "export type Shape = { kind: string };\n",
      "unreached.ts": "export const unreached = 3;\n",
      "fixture.json": "{}\n",
    };
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(folder, name), contents);
    const declared = { entries: [join(folder, "entry.ts")], inputs: [join(folder, "fixture.json")], model: "model-a" };
    const before = inputHash(declared);

    // #when
    writeFileSync(join(folder, changed), `${files[changed]}\n`);
    const after = inputHash(declared);

    // #then
    expect(after !== before).toBe(changes);
  });

  test("an eval whose inputs changed since its recorded pass is stale, naming the command to run", () => {
    // #given
    const folder = tempDir();
    const fixture = join(folder, "fixture.json");
    writeFileSync(fixture, "{}\n");
    const declared = { name: "toy", entries: [], inputs: [fixture], model: "model-a" };
    const passed = { toy: { hash: inputHash(declared), date: "2026-10-26", model: "model-a" } };

    // #when
    const fresh = staleEvals([declared], passed);
    writeFileSync(fixture, '{ "picks": [] }\n');
    const changed = staleEvals([declared], passed);
    const neverPassed = staleEvals([declared], {});

    // #then
    expect({ fresh, changed, neverPassed }).toEqual({
      fresh: [],
      changed: ["toy: inputs changed since the pass recorded on 2026-10-26; run `bun run eval toy`"],
      neverPassed: ["toy: no pass recorded; run `bun run eval toy`"],
    });
  });
});

describe("the daily eval's checks", () => {
  const PROMPT = `id: arxiv:2610.30001
title: Tutoring Agents That Remember: Long-Horizon Context for Course Assistants
abstract: We study course assistants.

id: arxiv:2610.30002
title: Grading at Scale
abstract: We study grading.`;
  const EXPECTED = { ids: ["arxiv:2610.30001", "arxiv:2610.30002"] };
  const REPLY = {
    take: "Both Picks ask what course assistants should remember, and \"Tutoring Agents That Remember\" gives the clearest answer.",
    picks: [
      { id: "arxiv:2610.30001", why: "It tests memory in course assistants, which is your context work.", summary: "Assistants kept notes across a term. Students rated them higher, e.g. on recall." },
      { id: "arxiv:2610.30002", why: "It measures grading by LLMs at scale.", summary: "LLM grades matched TAs on 3.5 of 4 rubric items." },
    ],
  };

  test("passes a reply that meets every check", () => {
    // #given
    const reply = REPLY;

    // #when
    const failures = checkDaily(reply, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual([]);
  });

  test("fails a reply off the schema, and checks nothing else", () => {
    // #given
    const reply = { take: 3, picks: [{ id: "arxiv:2610.30001", why: "Why." }], extra: true };

    // #when
    const failures = checkDaily(reply, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual(["extra is not in the schema", "take is not a string", "picks[0].summary is missing"]);
  });

  test("names each Pick missing, repeated or not in the input", () => {
    // #given
    const [first, second] = REPLY.picks as [(typeof REPLY.picks)[0], (typeof REPLY.picks)[0]];
    const reply = { ...REPLY, picks: [first, first, { ...second, id: "arxiv:2610.39999" }] };

    // #when
    const failures = checkDaily(reply, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual(["arxiv:2610.30001 has 2 entries", "arxiv:2610.30002 has no entry", "arxiv:2610.39999 is not a Pick"]);
  });

  test("fails a why over 30 words, a summary over 2 sentences and a take over 60 words", () => {
    // #given
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const [first, second] = REPLY.picks as [(typeof REPLY.picks)[0], (typeof REPLY.picks)[0]];
    const reply = { take: `${words(61)}.`, picks: [{ ...first, why: words(31) }, { ...second, summary: "One. Two et al. found it. Three!" }] };

    // #when
    const failures = checkDaily(reply, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual(["the take has 61 words, over 60", "the why of arxiv:2610.30001 has 31 words, over 30", "the summary of arxiv:2610.30002 has 3 sentences, over 2"]);
  });

  test.each([
    ["names both days", "From Sat 24 Oct to Mon 26 Oct, assistants dominate.", []],
    ["names a range", "Across October 24–26, assistants dominate.", []],
    ["names them in ISO form", "From 2026-10-24 to 2026-10-26, assistants dominate.", []],
    ["names only the last day", "By Monday 26 October, assistants dominate.", ["the take of a catch-up never names 24 Oct"]],
    ["names no day", "Over the weekend, assistants dominate.", ["the take of a catch-up never names 24 Oct", "the take of a catch-up never names 26 Oct"]],
  ])("checks that a catch-up's take names its dates: a take that %s", (_, take, expected) => {
    // #given
    const covers = { from: new Date(2026, 9, 24), to: new Date(2026, 9, 26) };

    // #when
    const failures = checkDaily({ ...REPLY, take }, { ...EXPECTED, covers }, PROMPT);

    // #then
    expect(failures).toEqual(expected);
  });

  test("fails URLs, arXiv ids, DOIs and quoted titles that are not in the input", () => {
    // #given
    const take = `Read it at https://arxiv.org/abs/2610.30001, beside 2610.31111, doi 10.1145/3700001 and *Memory Is All You Need*; "Grading at Scale" is in the input.`;

    // #when
    const failures = checkDaily({ ...REPLY, take }, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual([
      "names https://arxiv.org/abs/2610.30001, which is not in the input",
      "names 2610.31111, which is not in the input",
      "names 10.1145/3700001, which is not in the input",
      'names "Memory Is All You Need", which is not in the input',
    ]);
  });

  test("fails a glossary Avoid word anywhere in the prose", () => {
    // #given
    const take = "Today's Digest is about assistants, each article on memory.";

    // #when
    const failures = checkDaily({ ...REPLY, take }, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual(['uses "Digest", an avoided Glossary term', 'uses "article", an avoided Glossary term']);
  });
});

describe("the weekly eval's checks", () => {
  const TITLES = ["TutorBench: Grading Tutoring Agents", "Memory for Course Assistants", "Context Rot in Long Sessions", "Peer Review with LLMs"];
  const PROMPT = TITLES.map((title, i) => `id: arxiv:2610.3000${i + 1}\ntitle: ${title}`).join("\n\n");
  const REPLY = {
    themes: [
      { headline: "Tutors get graded.", body: "TutorBench and Memory for Course Assistants both test assistants on real courses." },
      { headline: "Context wears out.", body: "Context Rot in Long Sessions and peer review with LLMs (Peer Review with LLMs) find quality falls with length." },
    ],
  };

  test("passes 2 to 4 themes that each cite at least 2 input Picks by title", () => {
    // #given
    const reply = REPLY;

    // #when
    const failures = checkWeekly(reply, TITLES, PROMPT);

    // #then
    expect(failures).toEqual([]);
  });

  test("fails a single theme, and a theme citing fewer than 2 Picks", () => {
    // #given
    const reply = { themes: [{ headline: "Tutors get graded.", body: "TutorBench leads a quiet week." }] };

    // #when
    const failures = checkWeekly(reply, TITLES, PROMPT);

    // #then
    expect(failures).toEqual(["1 theme, expected 2–4", 'the theme "Tutors get graded." cites 1 Pick, fewer than 2']);
  });

  test("fails a URL or quoted title not in the input", () => {
    // #given
    const [first, second] = REPLY.themes as [(typeof REPLY.themes)[0], (typeof REPLY.themes)[0]];
    const reply = { themes: [first, { ...second, body: `${second.body} See "Attention Is Not Memory" at https://example.org/x.` }] };

    // #when
    const failures = checkWeekly(reply, TITLES, PROMPT);

    // #then
    expect(failures).toEqual(["names https://example.org/x, which is not in the input", 'names "Attention Is Not Memory", which is not in the input']);
  });

  test("fails a rendered Top Pick that is not one of the week's Picks", () => {
    // #given
    const markdown = `## Top Picks

- [ ] Keep [TutorBench](https://arxiv.org/abs/2610.30001) · from [[2026-10-19 Daily Briefing]] ^pick-2610-30001
- [ ] Keep [Elsewhere](https://arxiv.org/abs/2610.39999) · from [[2026-10-20 Daily Briefing]] ^pick-2610-39999

## Daily Briefings`;

    // #when
    const failures = checkTopPicks(markdown, ["https://arxiv.org/abs/2610.30001"]);

    // #then
    expect(failures).toEqual(["the Top Pick https://arxiv.org/abs/2610.39999 is not one of the week's Picks"]);
  });
});

describe("the keep eval's checks", () => {
  const PROMPT = "id: arxiv:2610.30001\ntitle: Memory for Course Assistants\nlink: https://arxiv.org/abs/2610.30001";
  const LEARNINGS = [
    "Course assistants that keep a per-student note across a term answer follow-ups better than ones that start fresh. https://arxiv.org/abs/2610.30001",
    "Memory for Course Assistants found students trusted assistants less when they recalled grades unprompted.",
  ];

  test("passes 2 to 4 Learnings that each stand alone as one sentence", () => {
    // #given
    const reply = { header: "Memory for Course Assistants (arXiv 2610.30001) https://arxiv.org/abs/2610.30001", learnings: LEARNINGS };

    // #when
    const failures = checkKeep(reply, PROMPT);

    // #then
    expect(failures).toEqual([]);
  });

  test("fails a single Learning as off the schema", () => {
    // #given
    const reply = { header: "Memory for Course Assistants", learnings: [LEARNINGS[0]] };

    // #when
    const failures = checkKeep(reply, PROMPT);

    // #then
    expect(failures).toEqual(["learnings has 1 entries, fewer than 2"]);
  });

  test("fails a Learning of two sentences, one over two lines, and one leaning on another", () => {
    // #given
    const reply = {
      header: "Memory for Course Assistants",
      learnings: ["Assistants kept notes. Students liked it.", "Assistants kept notes\nacross a term.", "It also cut repeat questions by a third."],
    };

    // #when
    const failures = checkKeep(reply, PROMPT);

    // #then
    expect(failures).toEqual([
      'Learning 1 is 2 sentences, not one statement: "Assistants kept notes. Students liked it."',
      "Learning 2 runs over 2 lines",
      'Learning 3 leans on what came before it: "It also cut repeat questions by a third."',
    ]);
  });
});

describe("the keep eval's write-dump dry run", () => {
  const DUMP = { briefing: "Research/Briefings/Daily/2026-10-26 Daily Briefing.md", paper: "arxiv:2610.30001", project: "Wildcards", slug: "Memory for Course Assistants", body: "## Learnings\n- [ ] One.\n" };
  const answering = (result: CommandResult) => {
    const calls: { argv: string[]; stdin: string }[] = [];
    const exec: Exec = async (argv, { stdin = "" }) => {
      calls.push({ argv, stdin });
      return result;
    };
    return { exec, calls };
  };

  test("runs the Briefing-origin write-dump Keeps use, with --dry-run, on the Dump body", async () => {
    // #given
    const { exec, calls } = answering({ exitCode: 0, stdout: "Inbox/2026-10-27 0600 Wildcards - Memory for Course Assistants.md\n", stderr: "" });

    // #when
    const failures = await writeDumpDryRun(exec, "brain-dump")(DUMP);

    // #then
    expect({ failures, calls }).toEqual({
      failures: [],
      calls: [
        {
          argv: ["brain-dump", "write-dump", "--origin", "briefing", "--briefing", DUMP.briefing, "--paper", DUMP.paper, "--project", "Wildcards", "--slug", DUMP.slug, "--dry-run"],
          stdin: DUMP.body,
        },
      ],
    });
  });

  test("fails, naming Brain-Dump#127, while write-dump has no --dry-run or Briefing origin", async () => {
    // #given
    const { exec } = answering({ exitCode: 2, stdout: "", stderr: "brain-dump: Unknown option '--origin'. To specify a positional argument starting with a '-', place it at the end\n" });

    // #when
    const failures = await writeDumpDryRun(exec, "brain-dump")(DUMP);

    // #then
    expect(failures).toEqual([
      "brain-dump write-dump can't check the Dump: it has no --dry-run or Briefing origin yet (Brain-Dump#127); it said: brain-dump: Unknown option '--origin'. To specify a positional argument starting with a '-', place it at the end",
    ]);
  });

  test("fails with write-dump's reason when it refuses the Dump", async () => {
    // #given
    const { exec } = answering({ exitCode: 1, stdout: "", stderr: "brain-dump: invalid Dump body: a Learning must be one line\n" });

    // #when
    const failures = await writeDumpDryRun(exec, "brain-dump")(DUMP);

    // #then
    expect(failures).toEqual(["brain-dump write-dump --dry-run refused the Dump (exit 1): brain-dump: invalid Dump body: a Learning must be one line"]);
  });
});

describe("the evals on their fixtures", () => {
  const field = (prompt: string, name: string): string[] => [...prompt.matchAll(new RegExp(`^${name}: (.+)$`, "gm"))].map(([, value = ""]) => value);
  const GRADES = { faithful: 4, take: 4, trends: 4, "self-contained": 4, "worth keeping": 4 };

  /** A model that follows each prompt to the letter, from what the prompt gives it. */
  const obedient: Ask = async (schema, prompt) => {
    if (prompt.startsWith("Grade what")) return Object.fromEntries(Object.entries(GRADES).filter(([name]) => prompt.includes(`- ${name}:`)));
    if (schema === DAILY_SCHEMA) {
      const covers = prompt.match(/catches up on (.+?) to (.+?), so/);
      return {
        take: covers === null ? "Course assistants lead today." : `From ${covers[1]} to ${covers[2]}, course assistants lead.`,
        picks: field(prompt, "id").map((id) => ({ id, why: "It bears on your Interests.", summary: "It measured what it set out to." })),
      };
    }
    if (schema === THEMES_SCHEMA) {
      const titles = field(prompt, "title");
      return { themes: [0, 2].map((i) => ({ headline: `Thread ${i / 2 + 1}.`, body: `${titles[i]} and ${titles[i + 1]} point the same way.` })) };
    }
    const title = field(prompt, "title")[0];
    return { header: `${title} ${field(prompt, "link")[0]}`, learnings: [`${title} kept a per-student note.`, `${title} found the note helped.`] };
  };
  const writes: DumpCheck = async () => [];
  const run = async (declared: Eval) => Object.fromEntries(await Promise.all(declared.cases.map(async ({ name, run: once }) => [name, (await once()).failures])));

  test.each([
    ["daily", () => dailyEval(obedient), { normal: [], thin: [], "catch-up": [] }],
    ["weekly", () => weeklyEval(obedient), { week: [] }],
    ["keep", () => keepEval(obedient, writes), { "full-text": [], "abstract-only": [], wildcard: [] }],
  ])("the %s eval passes every fixture written as its prompt asks", async (_, declared, expected) => {
    // #given
    const evalUnderTest = declared();

    // #when
    const failures = await run(evalUnderTest);

    // #then
    expect(failures).toEqual(expected);
  });

  test("the daily eval fails the catch-up, and only it, when the take names no dates", async () => {
    // #given
    const undated: Ask = async (schema, prompt) => {
      const reply = await obedient(schema, prompt);
      return schema === DAILY_SCHEMA ? { ...(reply as object), take: "Course assistants lead." } : reply;
    };

    // #when
    const failures = await run(dailyEval(undated));

    // #then
    expect(failures).toEqual({ normal: [], thin: [], "catch-up": ["the take of a catch-up never names 24 Oct", "the take of a catch-up never names 26 Oct"] });
  });

  test("an eval fails a case with claude's own error when the call fails", async () => {
    // #given
    const loggedOut: Ask = async () => {
      throw new PaperBotError("claude -p failed: Not logged in · Please run /login");
    };

    // #when
    const failures = await run(keepEval(loggedOut, writes));

    // #then
    expect(failures.wildcard).toEqual(["claude -p failed: Not logged in · Please run /login"]);
  });

  test("the keep eval fails a case write-dump refuses", async () => {
    // #given
    const refuses: DumpCheck = async () => ["brain-dump write-dump --dry-run refused the Dump (exit 1): brain-dump: invalid Dump body"];

    // #when
    const failures = await run(keepEval(obedient, refuses));

    // #then
    expect(failures["abstract-only"]).toEqual(["brain-dump write-dump --dry-run refused the Dump (exit 1): brain-dump: invalid Dump body"]);
  });

  test("every eval hashes its declared inputs", () => {
    // #given
    const declared = EVALS;

    // #when
    const hashes = declared.map((evalUnderTest) => inputHash(evalUnderTest));

    // #then
    expect(hashes.every((hash) => /^[0-9a-f]{16}$/.test(hash))).toBe(true);
  });
});

describe("the rubric grade", () => {
  const CRITERIA = [
    { name: "faithful", ask: "Every summary says only what its abstract says." },
    { name: "take", ask: "The take is worth reading." },
  ];

  test("is the model's score from 1 to 5 for each criterion", async () => {
    // #given
    const ask: Ask = async () => ({ faithful: 4, take: 3 });

    // #when
    const graded = await grade(ask, CRITERIA, "input", "output");

    // #then
    expect(graded).toEqual({ scores: { faithful: 4, take: 3 } });
  });

  test("is an error, never a gate, when the model fails or scores out of range", async () => {
    // #given
    const failing: Ask = async () => {
      throw new PaperBotError("claude -p failed (exit 1): Not logged in");
    };
    const outOfRange: Ask = async () => ({ faithful: 6, take: 3 });

    // #when
    const graded = [await grade(failing, CRITERIA, "input", "output"), await grade(outOfRange, CRITERIA, "input", "output")];

    // #then
    expect(graded).toEqual([{ error: "claude -p failed (exit 1): Not logged in" }, { error: "grader replied off the schema: faithful is 6, above 5" }]);
  });
});
