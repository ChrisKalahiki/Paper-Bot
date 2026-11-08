import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInterestsNote } from "../src/interests.ts";

const SEED = readFileSync(join(import.meta.dir, "..", "docs", "drafts", "Interests.md"), "utf8");

const SEED_VENUES = [
  "L@S",
  "AIED",
  "EDM",
  "IJAIED",
  "Computers & Education",
  "Computers & Education: AI",
  "IEEE TLT",
  "NeurIPS",
  "ICML",
  "ICLR",
  "ACL",
  "EMNLP",
  "KDD",
  "CHI",
  "CSCW",
  "UIST",
  "TOCHI",
];

describe("reading the Interests Note", () => {
  test("reads each Interest heading of the seed note, leaving out Wildcards", () => {
    // #given
    const note = SEED;

    // #when
    const { interests } = parseInterestsNote(note, SEED_VENUES);

    // #then
    expect(interests.map((interest) => interest.name)).toEqual([
      "AI in higher education",
      "Agents and LLMs",
      "AI in HCI",
      "Context management in AI",
      "Multimodal and new kinds of models",
    ]);
  });

  test("reads the seed note's Venues, Avoid lists and Wildcard cap, with no issues", () => {
    // #given
    const note = SEED;

    // #when
    const { interests, wildcards, issues } = parseInterestsNote(note, SEED_VENUES);

    // #then
    expect({ first: interests[0], hci: interests[2], wildcards, issues }).toEqual({
      first: expect.objectContaining({
        name: "AI in higher education",
        venues: ["L@S", "AIED", "EDM", "IJAIED", "Computers & Education", "Computers & Education: AI", "IEEE TLT"],
        avoid: [
          "K-12-only studies unless they provide strong empirical evidence about AI tutoring or learning transfer that could inform higher education",
          "opinion pieces with no data or substantive theoretical or methodological contribution",
          "productivity claims that equate faster completion with learning",
        ],
      }),
      hci: expect.objectContaining({
        name: "AI in HCI",
        venues: ["CHI", "CSCW", "UIST", "TOCHI"],
        avoid: [
          "generic coding-assistant productivity comparisons with no insight into human behavior or artifact quality",
          "security benchmarks with no connection to human verification, AI coding workflows or deployed software",
        ],
      }),
      wildcards: expect.objectContaining({ cap: 1 }),
      issues: [],
    });
  });

  test("an Interest's description is its paragraph, without the bullets under it", () => {
    // #given
    const note = "# Interests\n\n## Agents\nHow agents plan\nover long tasks.\n\n- Venues: NeurIPS\n- Avoid: benchmarks\n\n## HCI\nHow people use AI.\n";

    // #when
    const { interests } = parseInterestsNote(note, ["NeurIPS"]);

    // #then
    expect(interests).toEqual([
      { name: "Agents", description: "How agents plan over long tasks.", venues: ["NeurIPS"], avoid: ["benchmarks"] },
      { name: "HCI", description: "How people use AI.", venues: [], avoid: [] },
    ]);
  });

  test("a note with no Interest headings has no Interests", () => {
    // #given
    const note = "# Interests\n\nNothing yet.\n\n## Wildcards\nUp to 1 per Daily Briefing.\n";

    // #when
    const { interests } = parseInterestsNote(note, []);

    // #then
    expect(interests).toEqual([]);
  });
});

describe("the Wildcard cap", () => {
  test("is the N of \"Up to N per Daily Briefing\"", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n\n## Wildcards\nUp to 3 per Daily Briefing.\n";

    // #when
    const { wildcards } = parseInterestsNote(note, []);

    // #then
    expect(wildcards).toEqual({ cap: 3, hint: "" });
  });

  test("is 1 when the Wildcards section gives no number", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n\n## Wildcards\nAnything surprising.\n";

    // #when
    const { wildcards } = parseInterestsNote(note, []);

    // #then
    expect(wildcards).toEqual({ cap: 1, hint: "Anything surprising." });
  });

  test("is 0 when there is no Wildcards section", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n";

    // #when
    const { wildcards } = parseInterestsNote(note, []);

    // #then
    expect(wildcards).toEqual({ cap: 0, hint: "" });
  });
});

describe("Interests Note issues", () => {
  test("an unreadable bullet is an issue, and the rest of the note is still read", () => {
    // #given
    const note = "## Agents\nHow agents plan.\n\n- Venues: NeurIPS\n- Priority: high\n- just a thought\n- Avoid:\n\n## HCI\nHow people use AI.\n";

    // #when
    const result = parseInterestsNote(note, ["NeurIPS"]);

    // #then
    expect(result).toEqual({
      interests: [
        { name: "Agents", description: "How agents plan.", venues: ["NeurIPS"], avoid: [] },
        { name: "HCI", description: "How people use AI.", venues: [], avoid: [] },
      ],
      wildcards: { cap: 0, hint: "" },
      followedGroups: [],
      issues: ['unreadable bullet under Agents: "- Priority: high"', 'unreadable bullet under Agents: "- just a thought"', 'unreadable bullet under Agents: "- Avoid:"'],
    });
  });

  test("a Venue missing from the config is an issue, and still reaches ranking", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n\n- Venues: CHI, Ubicomp\n";

    // #when
    const { interests, issues } = parseInterestsNote(note, ["CHI", "CSCW"]);

    // #then
    expect({ venues: interests[0]?.venues, issues }).toEqual({ venues: ["CHI", "Ubicomp"], issues: ['unknown Venue under HCI: "Ubicomp"'] });
  });
});

describe("Followed Groups", () => {
  test("reads each group's name and members, each member with one or more OpenAlex author ids", () => {
    // #given
    const note = `## HCI
How people use AI.

## Followed Groups
- Koedinger lab: Kenneth Koedinger (A5012345678); Vincent Aleven (A5087654321, a5011111111)
- DeepMind agents: Jane Doe (A5022222222)
`;

    // #when
    const { interests, followedGroups, issues } = parseInterestsNote(note, []);

    // #then
    expect({ interests: interests.map((interest) => interest.name), followedGroups, issues }).toEqual({
      interests: ["HCI"],
      followedGroups: [
        {
          name: "Koedinger lab",
          members: [
            { name: "Kenneth Koedinger", ids: ["A5012345678"] },
            { name: "Vincent Aleven", ids: ["A5087654321", "A5011111111"] },
          ],
        },
        { name: "DeepMind agents", members: [{ name: "Jane Doe", ids: ["A5022222222"] }] },
      ],
      issues: [],
    });
  });

  test("an unreadable group or a malformed author id is an issue, and the group's readable members are still followed", () => {
    // #given
    const note = `## HCI
How people use AI.

## Followed Groups
- Koedinger lab: Kenneth Koedinger (A5012345678); Vincent Aleven (W123)
- Jane Doe
- Empty lab:
`;

    // #when
    const { followedGroups, issues } = parseInterestsNote(note, []);

    // #then
    expect({ followedGroups, issues }).toEqual({
      followedGroups: [{ name: "Koedinger lab", members: [{ name: "Kenneth Koedinger", ids: ["A5012345678"] }] }],
      issues: [
        'unreadable member of Koedinger lab: "Vincent Aleven (W123)"',
        'unreadable Followed Group: "- Jane Doe"',
        'unreadable Followed Group: "- Empty lab:"',
      ],
    });
  });

  test("a group whose every member is unreadable is reported once per member, not again as a group", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n\n## Followed Groups\n- Koedinger lab: Vincent Aleven (W123)\n";

    // #when
    const { followedGroups, issues } = parseInterestsNote(note, []);

    // #then
    expect({ followedGroups, issues }).toEqual({ followedGroups: [], issues: ['unreadable member of Koedinger lab: "Vincent Aleven (W123)"'] });
  });

  test("a note with no Followed Groups section follows none", () => {
    // #given
    const note = "## HCI\nHow people use AI.\n";

    // #when
    const { followedGroups } = parseInterestsNote(note, []);

    // #then
    expect(followedGroups).toEqual([]);
  });
});
