import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchArxivCandidates } from "../src/sources/arxiv.ts";

const FEED = readFileSync(join(import.meta.dir, "fixtures", "arxiv-rss.xml"), "utf8");

describe("the arXiv source", () => {
  test("asks for one combined RSS feed of the configured categories", async () => {
    // #given
    const requested: string[] = [];
    const fetch = async (url: string) => {
      requested.push(url);
      return new Response(FEED);
    };

    // #when
    await fetchArxivCandidates(fetch, ["cs.AI", "cs.CL", "cs.HC"]);

    // #then
    expect(requested).toEqual(["https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.HC"]);
  });

  test("keeps new and cross-listed Papers, with their ids, title, authors, link and abstract", async () => {
    // #given
    const fetch = async () => new Response(FEED);

    // #when
    const candidates = await fetchArxivCandidates(fetch, ["cs.AI"]);

    // #then
    expect(candidates).toEqual([
      {
        source: "arxiv",
        ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109"],
        title: "Context or Knowledge: How LLMs Attribute Their Own Answers",
        authors: ["Afendulev", "Dontsov", "Chepurova"],
        url: "https://arxiv.org/abs/2610.32109",
        abstract: "Editing the KV cache shows a model's report of where an answer came from ignores the document & follows the Q+A cache.",
      },
      {
        source: "arxiv",
        ids: ["arxiv:2610.31679", "doi:10.48550/arxiv.2610.31679"],
        title: "MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring",
        authors: ["Lee", "Woo", "Kim"],
        url: "https://arxiv.org/abs/2610.31679",
        abstract: "Five open-weight tutors over 5,000+ simulated dialogues; how you score them changes who looks good.",
      },
    ]);
  });

  test("an error status from arXiv fails the fetch, naming it", async () => {
    // #given
    const fetch = async () => new Response("busy", { status: 503 });

    // #when
    const fetching = fetchArxivCandidates(fetch, ["cs.AI"]);

    // #then
    await expect(fetching).rejects.toThrow("arXiv RSS answered 503");
  });
});
