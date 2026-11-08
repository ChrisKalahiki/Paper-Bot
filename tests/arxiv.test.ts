import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchArxivCandidates, fetchArxivSubmitted } from "../src/sources/arxiv.ts";

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

const API_FEED = readFileSync(join(import.meta.dir, "fixtures", "arxiv-api.xml"), "utf8");
const WINDOW = { from: new Date("2026-10-23T00:00:00Z"), to: new Date("2026-10-26T12:00:00Z") };

/** An arXiv API page of `count` entries, ids `2610.40001 + first` onward, out of `total`. */
function apiPage(first: number, count: number, total: number): string {
  const entries = Array.from({ length: count }, (_, i) => {
    const id = `2610.${40001 + first + i}`;
    return `<entry><id>http://arxiv.org/abs/${id}v1</id><title>Paper ${id}</title><summary>Abstract ${id}.</summary><author><name>Author</name></author></entry>`;
  });
  return `<feed><opensearch:totalResults>${total}</opensearch:totalResults>${entries.join("")}</feed>`;
}

describe("the arXiv query API, for catching up", () => {
  test("asks for every Paper in the categories submitted in the window, oldest first", async () => {
    // #given
    const requested: string[] = [];
    const fetch = async (url: string) => {
      requested.push(url);
      return new Response(API_FEED);
    };

    // #when
    await fetchArxivSubmitted(fetch, ["cs.AI", "cs.HC"], WINDOW, async () => {});

    // #then
    expect(requested).toEqual([
      "https://export.arxiv.org/api/query?search_query=%28cat:cs.AI+OR+cat:cs.HC%29+AND+submittedDate:[202610230000+TO+202610261200]&sortBy=submittedDate&sortOrder=ascending&start=0&max_results=2000",
    ]);
  });

  test("reads each entry's ids, title, authors, link and abstract, as the RSS feed gives them", async () => {
    // #given
    const fetch = async () => new Response(API_FEED);

    // #when
    const candidates = await fetchArxivSubmitted(fetch, ["cs.HC"], WINDOW, async () => {});

    // #then
    expect(candidates).toEqual([
      {
        source: "arxiv",
        ids: ["arxiv:2610.28811", "doi:10.48550/arxiv.2610.28811"],
        title: "Office Hours with an Agent: How Students Bring Context to LLM Tutors",
        authors: ["Okafor", "Lindqvist"],
        url: "https://arxiv.org/abs/2610.28811",
        abstract: "We log 1,200 office-hour chats and find students paste lecture notes & rubrics to steer the tutor.",
      },
      {
        source: "arxiv",
        ids: ["arxiv:2610.29034", "doi:10.48550/arxiv.2610.29034"],
        title: "Forgetting on Purpose: Context Eviction for Long-Horizon Agents",
        authors: ["Brandt"],
        url: "https://arxiv.org/abs/2610.29034",
        abstract: "An eviction policy that drops stale tool output keeps agents on task over 400 steps.",
      },
    ]);
  });

  test("pages through every match, waiting 3 s before each request after the first", async () => {
    // #given
    const pages: Record<string, string> = { "0": apiPage(0, 2000, 4500), "2000": apiPage(2000, 2000, 4500), "4000": apiPage(4000, 500, 4500) };
    const fetch = async (url: string) => new Response(pages[new URL(url).searchParams.get("start") ?? ""]);
    const waits: number[] = [];

    // #when
    const candidates = await fetchArxivSubmitted(fetch, ["cs.AI"], WINDOW, async (ms) => void waits.push(ms));

    // #then
    expect({ candidates: candidates.length, waits }).toEqual({ candidates: 4500, waits: [3000, 3000] });
  });

  test("an error status from the arXiv API fails the fetch, naming it", async () => {
    // #given
    const fetch = async () => new Response("busy", { status: 503 });

    // #when
    const fetching = fetchArxivSubmitted(fetch, ["cs.AI"], WINDOW, async () => {});

    // #then
    await expect(fetching).rejects.toThrow("arXiv API answered 503");
  });
});
