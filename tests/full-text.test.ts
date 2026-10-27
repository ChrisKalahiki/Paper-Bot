import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "../src/candidate.ts";
import { FULL_TEXT_LIMIT, readFullText } from "../src/full-text.ts";

const HTML = readFileSync(join(import.meta.dir, "fixtures", "arxiv-html.html"), "utf8");
const PDF = readFileSync(join(import.meta.dir, "fixtures", "paper.pdf"));

const arxivPaper: Candidate = {
  source: "arxiv",
  ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109"],
  title: "Context or Knowledge",
  url: "https://arxiv.org/abs/2610.32109",
  abstract: "Editing the KV cache.",
};

const venuePaper: Candidate = {
  source: "openalex",
  ids: ["doi:10.1145/3772318.3790001", "openalex:W4416000001"],
  title: "Students Steering LLM Tutors",
  url: "https://doi.org/10.1145/3772318.3790001",
  abstract: "Students steer tutors.",
  pdf: "https://example.edu/tutors.pdf",
};

function serving(bodies: Record<string, string | Uint8Array>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    const body = bodies[url];
    return body === undefined ? new Response("No HTML for this paper", { status: 404 }) : new Response(body);
  };
  return { fetch, requested };
}

describe("a Pick's full text", () => {
  test("is the text of its arXiv HTML article, without scripts, navigation or MathML markup", async () => {
    // #given
    const { fetch, requested } = serving({ "https://arxiv.org/html/2610.32109": HTML });

    // #when
    const text = await readFullText(fetch, arxivPaper);

    // #then
    expect({ text, requested }).toEqual({
      text: "Context or Knowledge: How LLMs Attribute Their Own Answers Abstract We edit the KV cache & ask the model where its answer came from. 1 Introduction Across 4 models of 7B–32B, the report follows the Q+A cache—not the document.",
      requested: ["https://arxiv.org/html/2610.32109"],
    });
  });

  test("is the text of its open-access PDF when arXiv has no HTML for it", async () => {
    // #given
    const { fetch } = serving({ "https://example.edu/tutors.pdf": PDF });

    // #when
    const text = await readFullText(fetch, { ...venuePaper, ids: ["arxiv:2609.11111", ...venuePaper.ids] });

    // #then
    expect(text).toBe("Full text of the Paper.");
  });

  test("is cut to its first characters when it is long", async () => {
    // #given
    const long = `<article><p>${"word ".repeat(FULL_TEXT_LIMIT)}</p></article>`;
    const { fetch } = serving({ "https://arxiv.org/html/2610.32109": long });

    // #when
    const text = await readFullText(fetch, arxivPaper);

    // #then
    expect(text?.length).toBe(FULL_TEXT_LIMIT);
  });

  test("is missing when there is neither arXiv HTML nor an open-access PDF", async () => {
    // #given
    const { fetch, requested } = serving({});

    // #when
    const text = await readFullText(fetch, { ...venuePaper, pdf: undefined });

    // #then
    expect({ text, requested }).toEqual({ text: undefined, requested: [] });
  });

  test("fails, naming the link, when the PDF is not one", async () => {
    // #given
    const { fetch } = serving({ "https://example.edu/tutors.pdf": "<html>Sign in to read</html>" });

    // #when
    const reading = readFullText(fetch, venuePaper);

    // #then
    await expect(reading).rejects.toThrow("https://example.edu/tutors.pdf is not a readable PDF");
  });
});
