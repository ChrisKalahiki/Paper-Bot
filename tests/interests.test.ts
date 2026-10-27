import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInterestsNote } from "../src/interests.ts";

const SEED = readFileSync(join(import.meta.dir, "..", "docs", "drafts", "Interests.md"), "utf8");

describe("reading the Interests Note", () => {
  test("reads each Interest heading of the seed note, leaving out Wildcards", () => {
    // #given
    const note = SEED;

    // #when
    const interests = parseInterestsNote(note);

    // #then
    expect(interests.map((interest) => interest.name)).toEqual([
      "AI in higher education",
      "Agents and LLMs",
      "AI in HCI",
      "Context management in AI",
      "Multimodal and new kinds of models",
    ]);
  });

  test("an Interest's description is its paragraph, without the bullets under it", () => {
    // #given
    const note = "# Interests\n\n## Agents\nHow agents plan\nover long tasks.\n\n- Venues: NeurIPS\n- Avoid: benchmarks\n\n## HCI\nHow people use AI.\n";

    // #when
    const interests = parseInterestsNote(note);

    // #then
    expect(interests).toEqual([
      { name: "Agents", description: "How agents plan over long tasks." },
      { name: "HCI", description: "How people use AI." },
    ]);
  });

  test("a note with no Interest headings has no Interests", () => {
    // #given
    const note = "# Interests\n\nNothing yet.\n\n## Wildcards\nUp to 1 per Daily Briefing.\n";

    // #when
    const interests = parseInterestsNote(note);

    // #then
    expect(interests).toEqual([]);
  });
});
