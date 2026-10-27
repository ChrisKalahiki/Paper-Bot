import { describe, expect, test } from "bun:test";
import { fetchOpenAiPointers } from "../src/sources/openai.ts";
import { fixture } from "./harness.ts";

function serving(bodies: Record<string, string>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    const body = bodies[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  };
  return { fetch, requested };
}

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
