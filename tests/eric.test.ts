import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchEricCandidates } from "../src/sources/eric.ts";
import { MONDAY } from "./harness.ts";

const RECORDS = readFileSync(join(import.meta.dir, "fixtures", "eric.json"), "utf8");
const page = (ids: string[], numFound: number) =>
  JSON.stringify({ response: { numFound, docs: ids.map((id) => ({ id, title: `Title ${id}`, description: `About ${id}.` })) } });

function recording(answer: (url: URL) => string = () => RECORDS) {
  const requested: URL[] = [];
  const fetch = async (url: string) => {
    requested.push(new URL(url));
    return new Response(answer(new URL(url)));
  };
  return { fetch, requested };
}

describe("the ERIC source", () => {
  test("asks for this year's Higher Education records, as JSON", async () => {
    // #given
    const { fetch, requested } = recording();

    // #when
    await fetchEricCandidates(fetch, MONDAY);

    // #then
    expect(requested.map((url) => ({ base: `${url.origin}${url.pathname}`, search: url.searchParams.get("search"), format: url.searchParams.get("format") }))).toEqual([
      { base: "https://api.ies.ed.gov/eric/", search: 'educationlevel:"Higher Education" AND e_yearadded:2026', format: "json" },
    ]);
  });

  test("in January also re-pulls last year's records", async () => {
    // #given
    const { fetch, requested } = recording();

    // #when
    await fetchEricCandidates(fetch, new Date("2027-01-04T12:00:00Z"));

    // #then
    expect(requested.map((url) => url.searchParams.get("search"))).toEqual(['educationlevel:"Higher Education" AND e_yearadded:(2027 OR 2026)']);
  });

  test("gives each record its ERIC id, the DOI inside its url, an ERIC link and its abstract", async () => {
    // #given
    const { fetch } = recording();

    // #when
    const candidates = await fetchEricCandidates(fetch, MONDAY);

    // #then
    expect(candidates).toEqual([
      {
        source: "eric",
        ids: ["doi:10.1080/03075079.2026.2290001", "eric:EJ1490001"],
        title: "Generative AI Feedback in First-Year Writing Courses",
        url: "https://eric.ed.gov/?id=EJ1490001",
        abstract: "A semester-long study of 412 students receiving LLM feedback on drafts.",
      },
      {
        source: "eric",
        ids: ["eric:ED670002"],
        title: "Institutional Policies on AI Use in Assessment",
        url: "https://eric.ed.gov/?id=ED670002",
        abstract: "A survey of 120 university policies.",
      },
    ]);
  });

  test("pages with start until every record found is read", async () => {
    // #given
    const pages: Record<string, string> = { "0": page(["EJ1"], 4500), "2000": page(["EJ2"], 4500), "4000": page(["EJ3"], 4500) };
    const { fetch, requested } = recording((url) => pages[url.searchParams.get("start") ?? ""] ?? page(["EJ4"], 4500));

    // #when
    const candidates = await fetchEricCandidates(fetch, MONDAY);

    // #then
    expect({ ids: candidates.map((c) => c.ids[0]), starts: requested.map((url) => url.searchParams.get("start")) }).toEqual({
      ids: ["eric:EJ1", "eric:EJ2", "eric:EJ3"],
      starts: ["0", "2000", "4000"],
    });
  });

  test("an error status from ERIC fails the fetch, naming it", async () => {
    // #given
    const fetch = async () => new Response("down", { status: 502 });

    // #when
    const fetching = fetchEricCandidates(fetch, MONDAY);

    // #then
    await expect(fetching).rejects.toThrow("ERIC answered 502");
  });
});
