import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchJmlrCandidates } from "../src/sources/jmlr.ts";
import { fetchPmlrCandidates } from "../src/sources/pmlr.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

function serving(feeds: Record<string, string>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    const feed = feeds[url];
    return feed === undefined ? new Response("not found", { status: 404 }) : new Response(feed);
  };
  return { fetch, requested };
}

const PMLR = { "https://proceedings.mlr.press/feed.xml": fixture("pmlr-root.xml"), "https://proceedings.mlr.press/v306/assets/rss/feed.xml": fixture("pmlr-v306.xml") };

describe("the PMLR source", () => {
  test("reads the newest ICML volume named in the root feed", async () => {
    // #given
    const { fetch, requested } = serving(PMLR);

    // #when
    await fetchPmlrCandidates(fetch);

    // #then
    expect(requested).toEqual(["https://proceedings.mlr.press/feed.xml", "https://proceedings.mlr.press/v306/assets/rss/feed.xml"]);
  });

  test("gives each Paper its PMLR URL as its id, its title and its abstract as text", async () => {
    // #given
    const { fetch } = serving(PMLR);

    // #when
    const candidates = await fetchPmlrCandidates(fetch);

    // #then
    expect(candidates).toEqual([
      {
        source: "pmlr",
        ids: ["url:https://proceedings.mlr.press/v306/lee26a.html"],
        title: "Memory Tokens for Long-Horizon Agents",
        url: "https://proceedings.mlr.press/v306/lee26a.html",
        abstract: "We give agents a learned memory budget that carries context across tool calls.",
      },
      {
        source: "pmlr",
        ids: ["url:https://proceedings.mlr.press/v306/ono26b.html"],
        title: "Sparse World Models",
        url: "https://proceedings.mlr.press/v306/ono26b.html",
        abstract: "",
      },
    ]);
  });

  test("has no Candidates when the root feed names no ICML volume", async () => {
    // #given
    const { fetch } = serving({ "https://proceedings.mlr.press/feed.xml": "<rss><channel></channel></rss>" });

    // #when
    const candidates = await fetchPmlrCandidates(fetch);

    // #then
    expect(candidates).toEqual([]);
  });

  test("an error status from PMLR fails the fetch, naming it", async () => {
    // #given
    const { fetch } = serving({ "https://proceedings.mlr.press/feed.xml": fixture("pmlr-root.xml") });

    // #when
    const fetching = fetchPmlrCandidates(fetch);

    // #then
    await expect(fetching).rejects.toThrow("PMLR answered 404");
  });
});

describe("the JMLR source", () => {
  test("gives each Paper in the feed its URL as its id, its title and abstract", async () => {
    // #given
    const { fetch } = serving({ "https://www.jmlr.org/jmlr.xml": fixture("jmlr.xml") });

    // #when
    const candidates = await fetchJmlrCandidates(fetch);

    // #then
    expect(candidates).toEqual([
      {
        source: "jmlr",
        ids: ["url:https://www.jmlr.org/papers/v27/25-0101.html"],
        title: "Convergence of Agentic Policy Search",
        url: "https://www.jmlr.org/papers/v27/25-0101.html",
        abstract: "We prove convergence for policy search with tool feedback.",
      },
    ]);
  });

  test("an error status from JMLR fails the fetch, naming it", async () => {
    // #given
    const { fetch } = serving({});

    // #when
    const fetching = fetchJmlrCandidates(fetch);

    // #then
    await expect(fetching).rejects.toThrow("JMLR answered 404");
  });
});
