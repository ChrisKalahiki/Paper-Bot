import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOpenAlexCandidates } from "../src/sources/openalex.ts";
import { MONDAY } from "./harness.ts";

const WORKS = readFileSync(join(import.meta.dir, "fixtures", "openalex-works.json"), "utf8");
const EMPTY = JSON.stringify({ meta: { next_cursor: null }, results: [] });

function recording(answer: (url: URL) => string = () => WORKS) {
  const requested: URL[] = [];
  const fetch = async (url: string) => {
    requested.push(new URL(url));
    return new Response(answer(new URL(url)));
  };
  return { fetch, requested };
}

const query = (url: URL) => ({ filter: url.searchParams.get("filter"), key: url.searchParams.get("api_key"), perPage: url.searchParams.get("per-page") });

describe("the OpenAlex source", () => {
  test("asks for a 14-day publication window over Education and HCI, and this and last year's works from the watched Venues, with the key", async () => {
    // #given
    const { fetch, requested } = recording(() => EMPTY);

    // #when
    await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: ["S4363607743", "S4363606243"] }, MONDAY);

    // #then
    expect(requested.map((url) => `${url.origin}${url.pathname}`)).toEqual(["https://api.openalex.org/works", "https://api.openalex.org/works"]);
    expect(requested.map(query)).toEqual([
      { filter: "primary_topic.subfield.id:3304|1709,from_publication_date:2026-10-12,to_publication_date:2026-10-26", key: "KEY", perPage: "200" },
      { filter: "primary_location.source.id:S4363607743|S4363606243,publication_year:2026|2025", key: "KEY", perPage: "200" },
    ]);
  });

  test("makes no Venue query when no Venue is watched", async () => {
    // #given
    const { fetch, requested } = recording(() => EMPTY);

    // #when
    await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [] }, MONDAY);

    // #then
    expect(requested.map((url) => url.searchParams.get("filter")?.split(":")[0])).toEqual(["primary_topic.subfield.id"]);
  });

  test("gives each work its id set, title, link, rebuilt abstract and open-access PDF", async () => {
    // #given
    const { fetch } = recording();

    // #when
    const candidates = await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [] }, MONDAY);

    // #then
    expect(candidates).toEqual([
      {
        source: "openalex",
        ids: ["doi:10.1145/3772318.3790001", "arxiv:2609.11111", "doi:10.48550/arxiv.2609.11111", "openalex:W4416000001"],
        title: "Students Steering LLM Tutors: A Field Study",
        url: "https://doi.org/10.1145/3772318.3790001",
        abstract: "Students steer tutors and trust tutors",
        pdf: "https://arxiv.org/pdf/2609.11111v2",
      },
      {
        source: "openalex",
        ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109", "openalex:W4416000002"],
        title: "Context or Knowledge: How LLMs Attribute Their Own Answers",
        url: "https://doi.org/10.48550/arxiv.2610.32109",
        abstract: "Editing the cache",
      },
      {
        source: "openalex",
        ids: ["openalex:W4416000003"],
        title: "Assessment Policy for Generative AI",
        url: "https://example.edu/policy",
        abstract: "",
      },
    ]);
  });

  test("tells the ranker a work was accepted at a Venue it knows, by the Venue's common name", async () => {
    // #given
    const { fetch } = recording();

    // #when
    const candidates = await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [], names: { S4363607743: "CHI" } }, MONDAY);

    // #then
    expect(candidates.map((candidate) => candidate.signals)).toEqual([["accepted at CHI"], undefined, undefined]);
  });

  test("follows the cursor until the last page", async () => {
    // #given
    const page = (title: string, next: string | null) =>
      JSON.stringify({ meta: { next_cursor: next }, results: [{ id: `https://openalex.org/W${title}`, doi: null, title, ids: {}, locations: [] }] });
    const pages: Record<string, string> = { "*": page("1", "c2"), c2: page("2", "c3"), c3: page("3", null) };
    const { fetch, requested } = recording((url) => pages[url.searchParams.get("cursor") ?? ""] ?? EMPTY);

    // #when
    const candidates = await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [] }, MONDAY);

    // #then
    expect({ titles: candidates.map((c) => c.title), cursors: requested.map((url) => url.searchParams.get("cursor")) }).toEqual({
      titles: ["1", "2", "3"],
      cursors: ["*", "c2", "c3"],
    });
  });

  test("asks for the 14-day publication window's works by the Followed Groups' members", async () => {
    // #given
    const { fetch, requested } = recording(() => EMPTY);

    // #when
    await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [], authorIds: ["A5012345678", "A5087654321"] }, MONDAY);

    // #then
    expect(requested.map((url) => url.searchParams.get("filter"))).toEqual([
      "primary_topic.subfield.id:3304|1709,from_publication_date:2026-10-12,to_publication_date:2026-10-26",
      "authorships.author.id:A5012345678|A5087654321,from_publication_date:2026-10-12,to_publication_date:2026-10-26",
    ]);
  });

  test("gives a work the OpenAlex ids of its authors", async () => {
    // #given
    const work = {
      id: "https://openalex.org/W1",
      title: "Tutors",
      authorships: [{ author: { id: "https://openalex.org/A5012345678" } }, { author: { id: "https://openalex.org/A5087654321" } }, { author: {} }],
    };
    const { fetch } = recording(() => JSON.stringify({ meta: { next_cursor: null }, results: [work] }));

    // #when
    const [candidate] = await fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [] }, MONDAY);

    // #then
    expect(candidate?.authorIds).toEqual(["A5012345678", "A5087654321"]);
  });

  test("an error status from OpenAlex fails the fetch, naming it", async () => {
    // #given
    const fetch = async () => new Response("Plan upgrade required", { status: 429 });

    // #when
    const fetching = fetchOpenAlexCandidates(fetch, { key: "KEY", venues: [] }, MONDAY);

    // #then
    await expect(fetching).rejects.toThrow("OpenAlex answered 429");
  });
});
