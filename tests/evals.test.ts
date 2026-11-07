import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDaily, checkKeep, checkRank, checkTopPicks, checkWeekly, type RankExpectation } from "../evals/assertions.ts";
import type { Ask } from "../evals/claude.ts";
import { dailyEval } from "../evals/daily.ts";
import { EVALS, type Eval, inputHash, staleEvals } from "../evals/eval.ts";
import { type DumpCheck, keepEval, writeDumpDryRun } from "../evals/keep.ts";
import { RANK_FIXTURES, rankEval, readRankFixtures } from "../evals/rank.ts";
import { grade } from "../evals/rubric.ts";
import { weeklyEval } from "../evals/weekly.ts";
import type { CommandResult, Exec } from "../src/command.ts";
import { catchUpSince } from "../src/catch-up.ts";
import { PaperBotError } from "../src/errors.ts";
import { THEMES_SCHEMA } from "../src/weekly.ts";
import { DAILY_SCHEMA } from "../src/write.ts";
import { tempDir, testConfig } from "./harness.ts";

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
    ["Oct 23 to 26", "2026-10-23", "2026-10-26"],
    ["Oct 30 to Nov 2", "2026-10-29", "2026-11-02"],
  ])("passes a catch-up's take as the Briefing renders it, its covers line naming the days: %s", (_, coveredThrough, today) => {
    // #given
    const covers = catchUpSince(coveredThrough, today);

    // #when
    const failures = checkDaily({ ...REPLY, take: "Over the weekend, assistants dominate." }, { ...EXPECTED, ...(covers === undefined ? {} : { covers }) }, PROMPT);

    // #then
    expect({ catchUp: covers !== undefined, failures }).toEqual({ catchUp: true, failures: [] });
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

  test.each([
    ["names a Briefing a Digest", "Today's Digest is about assistants.", ['uses "Digest", an avoided Glossary term']],
    ["names a Briefing a roundup", "This roundup is about assistants.", ['uses "roundup", an avoided Glossary term']],
    ["says we run ablations", "Both teams run ablations on memory.", []],
    ["mentions a job scheduler, a single pass and a news article", "A job scheduler makes a single pass over each news article.", []],
  ])("checks Avoid words that name paper-bot's own concepts, not ordinary English: prose that %s", (_, take, expected) => {
    // #given
    const reply = { ...REPLY, take };

    // #when
    const failures = checkDaily(reply, EXPECTED, PROMPT);

    // #then
    expect(failures).toEqual(expected);
  });
});

describe("the rank eval's checks", () => {
  const EXPECTED: RankExpectation = {
    labels: { "arxiv:1": "must-pick", "arxiv:2": "must-pick", "arxiv:3": "must-not", "arxiv:4": "don't-care", "arxiv:5": "don't-care" },
    bars: { pick: 7, wildcard: 8 },
    wildcardCap: 1,
  };
  const ranking = (id: string, score: number, wildcard = false) => ({ id, interests: wildcard ? [] : ["Agents and LLMs"], score, why: `Why ${id}.`, wildcard });
  const REPLY = { rankings: [ranking("arxiv:1", 9), ranking("arxiv:2", 7), ranking("arxiv:3", 6), ranking("arxiv:4", 2), ranking("arxiv:5", 8, true)] };

  test("passes a reply that meets every check", () => {
    // #given
    const reply = REPLY;

    // #when
    const failures = checkRank(reply, EXPECTED);

    // #then
    expect(failures).toEqual([]);
  });

  test("fails a reply off the schema, and checks nothing else", () => {
    // #given
    const reply = { rankings: [{ ...ranking("arxiv:1", 11), wildcard: "no" }] };

    // #when
    const failures = checkRank(reply, EXPECTED);

    // #then
    expect(failures).toEqual(["rankings[0].score is 11, above 10", "rankings[0].wildcard is not true or false"]);
  });

  test("names each Candidate not scored, scored twice, or not in the input", () => {
    // #given
    const [first, second, third, fourth] = REPLY.rankings as [ReturnType<typeof ranking>, ...ReturnType<typeof ranking>[]];
    const reply = { rankings: [first, second, third, fourth, fourth, ranking("arxiv:9", 3)] };

    // #when
    const failures = checkRank(reply, EXPECTED);

    // #then
    expect(failures).toEqual(["arxiv:4 is scored 2 times", "arxiv:5 is not scored", "arxiv:9 is not a Candidate"]);
  });

  test("fails a must-not scored at the Pick bar", () => {
    // #given
    const reply = { rankings: REPLY.rankings.map((entry) => (entry.id === "arxiv:3" ? { ...entry, score: 7 } : entry)) };

    // #when
    const failures = checkRank(reply, EXPECTED);

    // #then
    expect(failures).toEqual(["the must-not arxiv:3 scored 7, not below 7"]);
  });

  test.each([
    [4, 5, []],
    [3, 4, ["3 of 4 must-picks scored 7 or above, fewer than 4 in every 5; missed: arxiv:p4 (6)"]],
    [7, 9, ["7 of 9 must-picks scored 7 or above, fewer than 4 in every 5; missed: arxiv:p8 (6), arxiv:p9 (6)"]],
  ])("needs at least 4 in every 5 must-picks at the Pick bar: %p of %p", (hits, picks, expected) => {
    // #given
    const ids = Array.from({ length: picks }, (_, i) => `arxiv:p${i + 1}`);
    const labels = Object.fromEntries(ids.map((id) => [id, "must-pick" as const]));
    const reply = { rankings: ids.map((id, i) => ranking(id, i < hits ? 7 : 6)) };

    // #when
    const failures = checkRank(reply, { ...EXPECTED, labels });

    // #then
    expect(failures).toEqual(expected);
  });

  test("fails more Wildcards at the Wildcard bar than the cap, but not flags below the bar", () => {
    // #given
    const reply = { rankings: [ranking("arxiv:1", 9), ranking("arxiv:2", 7), ranking("arxiv:3", 6, true), ranking("arxiv:4", 8, true), ranking("arxiv:5", 9, true)] };

    // #when
    const failures = checkRank(reply, EXPECTED);

    // #then
    expect(failures).toEqual(["2 Wildcards scored 8 or above, over the cap of 1: arxiv:4, arxiv:5"]);
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

describe("the rank eval", () => {
  const candidate = (id: string, title: string) => ({ source: "arxiv", ids: [id], title, url: `https://arxiv.org/abs/${id}`, abstract: `We study ${title.toLowerCase()}.` });
  const DAY = [
    { label: "must-pick", candidate: candidate("arxiv:2610.40001", "Agents that plan") },
    { label: "must-not", candidate: candidate("arxiv:2610.40002", "Protein folding") },
    { label: "don't-care", candidate: candidate("arxiv:2610.40003", "Faster sorting") },
  ];
  const EDGES = [{ label: "must-pick", edge: "a boundary case", candidate: candidate("url:https://example.org/edge", "Context for coding agents") }];

  /** Fixture files in a temp folder, with the committed Interests Note. */
  function fixtures(day: { label: string }[], edges: { label: string }[]) {
    const folder = tempDir();
    const files = { interests: join(folder, "interests.md"), day: join(folder, "day.json"), edgeCases: join(folder, "edge-cases.json") };
    writeFileSync(files.interests, readFileSync(join(import.meta.dir, "..", "evals", "fixtures", "rank", "interests.md")));
    writeFileSync(files.day, JSON.stringify({ day: "2026-10-27", candidates: day }));
    writeFileSync(files.edgeCases, JSON.stringify({ candidates: edges }));
    return files;
  }

  const ids = (prompt: string): string[] => [...prompt.matchAll(/^id: (.+)$/gm)].map(([, id = ""]) => id);
  /** A ranker that scores must-picks 9 and everything else 3, and a grader that gives 4. */
  const labelled: Ask = async (_, prompt) => {
    if (prompt.startsWith("Grade what")) return { specific: 4 };
    const picks = new Set(["arxiv:2610.40001", "url:https://example.org/edge"]);
    return { rankings: ids(prompt).map((id) => ({ id, interests: ["Agents and LLMs"], score: picks.has(id) ? 9 : 3, why: `Why ${id}.`, wildcard: false })) };
  };
  const run = async (declared: Eval) => Promise.all(declared.cases.map(({ run: once }) => once()));

  test("refuses to pass, without calling the model, while any Candidate is unlabelled", async () => {
    // #given
    const files = fixtures([...DAY.slice(0, 2), { ...DAY[2], label: "" }], [{ ...EDGES[0], label: "" }]);
    let calls = 0;
    const counting: Ask = async (schema, prompt) => {
      calls += 1;
      return labelled(schema, prompt);
    };

    // #when
    const results = await run(rankEval(counting, files));

    // #then
    expect({ results, calls }).toEqual({
      results: [
        {
          failures: [
            `2 of 4 Candidates have no label yet; label each must-pick, must-not or don't-care in ${files.day} and ${files.edgeCases} before a pass can be recorded`,
          ],
        },
      ],
      calls: 0,
    });
  });

  test("refuses a label that is none of must-pick, must-not or don't-care", async () => {
    // #given
    const files = fixtures([...DAY.slice(0, 2), { ...DAY[2], label: "maybe" }], EDGES);

    // #when
    const results = await run(rankEval(labelled, files));

    // #then
    expect(results).toEqual([{ failures: ['arxiv:2610.40003 has the label "maybe", not must-pick, must-not or don\'t-care'] }]);
  });

  test("passes a labelled day ranked as labelled, with the advisory grade", async () => {
    // #given
    const files = fixtures(DAY, EDGES);

    // #when
    const results = await run(rankEval(labelled, files));

    // #then
    expect(results).toEqual([{ failures: [], grade: { scores: { specific: 4 } } }]);
  });

  test("fails a labelled day whose must-not scores at the Pick bar", async () => {
    // #given
    const files = fixtures(DAY, EDGES);
    const fooled: Ask = async (schema, prompt) => {
      const reply = (await labelled(schema, prompt)) as { rankings?: { id: string; score: number }[] };
      return reply.rankings === undefined ? reply : { rankings: reply.rankings.map((r) => (r.id === "arxiv:2610.40002" ? { ...r, score: 8 } : r)) };
    };

    // #when
    const [result] = await run(rankEval(fooled, files));

    // #then
    expect(result?.failures).toEqual(["the must-not arxiv:2610.40002 scored 8, not below 7"]);
  });

  test("fails with codex's own error when the call fails", async () => {
    // #given
    const files = fixtures(DAY, EDGES);
    const loggedOut: Ask = async () => {
      throw new PaperBotError("codex exec failed (exit 1): Not logged in");
    };

    // #when
    const results = await run(rankEval(loggedOut, files));

    // #then
    expect(results).toEqual([{ failures: ["codex exec failed (exit 1): Not logged in"] }]);
  });

  test("its committed day fits one ranking batch, each Candidate once with a label column", () => {
    // #given
    const fixture = readRankFixtures(RANK_FIXTURES);

    // #when
    const ids = fixture.map(({ candidate }) => candidate.ids[0]);
    const labels = new Set(fixture.map(({ label }) => label));

    // #then
    expect({
      fits: fixture.length >= 90 && fixture.length <= testConfig().batch.size,
      unique: new Set(ids).size === ids.length,
      labels: [...labels].every((label) => ["", "must-pick", "must-not", "don't-care"].includes(label)),
    }).toEqual({ fits: true, unique: true, labels: true });
  });
});

describe("the evals on their fixtures", () => {
  const field = (prompt: string, name: string): string[] => [...prompt.matchAll(new RegExp(`^${name}: (.+)$`, "gm"))].map(([, value = ""]) => value);
  const GRADES = { faithful: 4, take: 4, trends: 4, "self-contained": 4, "worth keeping": 4 };

  /** A model that follows each prompt to the letter, from what the prompt gives it. */
  const obedient: Ask = async (schema, prompt) => {
    if (prompt.startsWith("Grade what")) return Object.fromEntries(Object.entries(GRADES).filter(([name]) => prompt.includes(`- ${name}:`)));
    if (schema === DAILY_SCHEMA) {
      return {
        take: "Course assistants lead today.",
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

  test("the daily eval fails each fixture whose reply leaves out its last Pick", async () => {
    // #given
    const forgetful: Ask = async (schema, prompt) => {
      const reply = await obedient(schema, prompt);
      return schema === DAILY_SCHEMA ? { ...(reply as object), picks: field(prompt, "id").slice(0, -1).map((id) => ({ id, why: "Why.", summary: "What." })) } : reply;
    };

    // #when
    const failures = await run(dailyEval(forgetful));

    // #then
    expect(failures).toEqual({ normal: ["doi:10.1145/3706598.3713012 has no entry"], thin: ["arxiv:2610.19702 has no entry"], "catch-up": ["arxiv:2610.21890 has no entry"] });
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
