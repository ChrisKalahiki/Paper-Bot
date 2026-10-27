import { describe, expect, test } from "bun:test";
import { fetchAnthropicPointers } from "../src/sources/anthropic.ts";
import { fetchDeepMindPointers } from "../src/sources/deepmind.ts";
import { fetchOpenAiPointers } from "../src/sources/openai.ts";
import { fixture, MONDAY } from "./harness.ts";

function serving(bodies: Record<string, string>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    const body = bodies[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  };
  return { fetch, requested };
}

const DEEPMIND = {
  "https://deepmind.google/research/publications/": fixture("deepmind-publications.html"),
  "https://deepmind.google/research/publications/231045/": fixture("deepmind-publication-231045.html"),
  "https://deepmind.google/research/publications/231020/": fixture("deepmind-publication-231020.html"),
  "https://deepmind.google/research/publications/230990/": fixture("deepmind-publication-230990.html"),
};
const everyPost = (urls: string[]) => urls;

describe("the DeepMind pointer", () => {
  test("reads the first publications page, then each publication it has not read before", async () => {
    // #given
    const { fetch, requested } = serving(DEEPMIND);
    const unread = (urls: string[]) => urls.filter((url) => !url.endsWith("/231045/"));

    // #when
    await fetchDeepMindPointers(fetch, unread);

    // #then
    expect(requested).toEqual([
      "https://deepmind.google/research/publications/",
      "https://deepmind.google/research/publications/231020/",
      "https://deepmind.google/research/publications/230990/",
    ]);
  });

  test("points at a Paper by the arXiv id or DOI of its sameAs link", async () => {
    // #given
    const { fetch } = serving(DEEPMIND);

    // #when
    const { signals } = await fetchDeepMindPointers(fetch, everyPost);

    // #then
    expect(signals).toEqual([
      { ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109"], text: "announced by DeepMind" },
      { ids: ["doi:10.1145/3772318.3790001"], text: "announced by DeepMind" },
    ]);
  });

  test("makes a Paper with no arXiv id or DOI a Candidate identified by its URL", async () => {
    // #given
    const { fetch } = serving(DEEPMIND);

    // #when
    const { candidates } = await fetchDeepMindPointers(fetch, everyPost);

    // #then
    expect(candidates).toEqual([
      {
        source: "deepmind",
        ids: ["url:https://openreview.net/forum?id=Ab12Cd34"],
        title: "Tutoring Agents That Ask Before They Tell",
        url: "https://openreview.net/forum?id=Ab12Cd34",
        abstract: "A tutoring agent that asks a diagnostic question and then explains helps students more than one that explains at once.",
        signals: ["announced by DeepMind"],
      },
    ]);
  });

  test("reports every publication it read, so the next Scan skips them", async () => {
    // #given
    const { fetch } = serving(DEEPMIND);

    // #when
    const { read } = await fetchDeepMindPointers(fetch, everyPost);

    // #then
    expect(read).toEqual([
      "https://deepmind.google/research/publications/231045/",
      "https://deepmind.google/research/publications/231020/",
      "https://deepmind.google/research/publications/230990/",
    ]);
  });

  test("fails with DeepMind's status when a publication page answers with an error", async () => {
    // #given
    const { fetch } = serving({ "https://deepmind.google/research/publications/": fixture("deepmind-publications.html") });

    // #when
    const fetching = fetchDeepMindPointers(fetch, everyPost);

    // #then
    await expect(fetching).rejects.toThrow("DeepMind answered 404 for https://deepmind.google/research/publications/231045/");
  });
});

const ANTHROPIC = {
  "https://www.anthropic.com/research": fixture("anthropic-research.html"),
  "https://www.anthropic.com/research/context-attribution": fixture("anthropic-post-context-attribution.html"),
  "https://www.anthropic.com/research/tutoring-evals": fixture("anthropic-post-tutoring-evals.html"),
  "https://www.anthropic.com/research/team-update": fixture("anthropic-post-team-update.html"),
  "https://transformer-circuits.pub/feed.xml": fixture("transformer-circuits.xml"),
};

describe("the Anthropic pointer", () => {
  test("reads /research and the transformer-circuits feed, then each research post it has not read before", async () => {
    // #given
    const { fetch, requested } = serving(ANTHROPIC);
    const unread = (urls: string[]) => urls.filter((url) => !url.endsWith("/team-update"));

    // #when
    await fetchAnthropicPointers(fetch, unread, MONDAY);

    // #then
    expect(requested.sort()).toEqual([
      "https://transformer-circuits.pub/feed.xml",
      "https://www.anthropic.com/research",
      "https://www.anthropic.com/research/context-attribution",
      "https://www.anthropic.com/research/tutoring-evals",
    ]);
  });

  test("points at a Paper by the arXiv id of the first Paper a post links", async () => {
    // #given
    const { fetch } = serving(ANTHROPIC);

    // #when
    const { signals } = await fetchAnthropicPointers(fetch, everyPost, MONDAY);

    // #then
    expect(signals).toEqual([{ ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109"], text: "announced by Anthropic" }]);
  });

  test("makes a transformer-circuits article from the last 14 days, and a Paper a post links only as a PDF, Candidates identified by their URLs", async () => {
    // #given
    const { fetch } = serving(ANTHROPIC);

    // #when
    const { candidates } = await fetchAnthropicPointers(fetch, everyPost, MONDAY);

    // #then
    expect(candidates).toEqual([
      {
        source: "anthropic",
        ids: ["url:https://transformer-circuits.pub/2026/context-heads/index.html"],
        title: "Tracing Context Use in Attention Heads",
        url: "https://transformer-circuits.pub/2026/context-heads/index.html",
        abstract: "We find heads that decide whether to answer from context or from weights.",
        signals: ["announced by Anthropic"],
      },
      {
        source: "anthropic",
        ids: ["url:https://www-cdn.anthropic.com/a1b2c3/grading-tutors.pdf"],
        title: "Grading Tutors with Simulated Students",
        url: "https://www-cdn.anthropic.com/a1b2c3/grading-tutors.pdf",
        abstract: "We grade AI tutors against simulated students & find the grading changes the winner.",
        signals: ["announced by Anthropic"],
      },
    ]);
  });

  test("reports every research post it read, so the next Scan skips them", async () => {
    // #given
    const { fetch } = serving(ANTHROPIC);

    // #when
    const { read } = await fetchAnthropicPointers(fetch, everyPost, MONDAY);

    // #then
    expect(read).toEqual([
      "https://www.anthropic.com/research/context-attribution",
      "https://www.anthropic.com/research/tutoring-evals",
      "https://www.anthropic.com/research/team-update",
    ]);
  });
});

describe("the OpenAI pointer", () => {
  test("points at a Paper by the title of each Research or Publication item, adding no Candidates", async () => {
    // #given
    const { fetch } = serving({ "https://openai.com/news/rss.xml": fixture("openai-news.xml") });

    // #when
    const pointers = await fetchOpenAiPointers(fetch);

    // #then
    expect(pointers).toEqual({
      candidates: [],
      signals: [
        { title: "Context or knowledge: how LLMs attribute their own answers", text: "announced by OpenAI" },
        { title: "Grading tutors at scale", text: "announced by OpenAI" },
      ],
    });
  });

  test("fails with OpenAI's status when it answers with an error", async () => {
    // #given
    const { fetch } = serving({});

    // #when
    const fetching = fetchOpenAiPointers(fetch);

    // #then
    await expect(fetching).rejects.toThrow("OpenAI answered 404");
  });
});
