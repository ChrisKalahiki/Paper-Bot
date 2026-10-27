import { describe, expect, test } from "bun:test";
import { fetchHfPointers } from "../src/sources/hf.ts";
import { fixture, MONDAY } from "./harness.ts";

function serving(body: string, status = 200) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    return new Response(body, { status });
  };
  return { fetch, requested };
}

describe("the HF daily papers pointer", () => {
  test("asks for the Scan's day", async () => {
    // #given
    const { fetch, requested } = serving("[]");

    // #when
    await fetchHfPointers(fetch, MONDAY);

    // #then
    expect(requested).toEqual(["https://huggingface.co/api/daily_papers?date=2026-10-26"]);
  });

  test("points at each listed Paper by its arXiv ids, adding no Candidates", async () => {
    // #given
    const { fetch } = serving(fixture("hf-daily-papers.json"));

    // #when
    const pointers = await fetchHfPointers(fetch, MONDAY);

    // #then
    expect(pointers).toEqual({
      candidates: [],
      signals: [
        { ids: ["arxiv:2610.32109", "doi:10.48550/arxiv.2610.32109"], text: "on HF daily papers" },
        { ids: ["arxiv:2610.29001", "doi:10.48550/arxiv.2610.29001"], text: "on HF daily papers" },
      ],
    });
  });

  test("fails with HF's status when it answers with an error", async () => {
    // #given
    const { fetch } = serving("busy", 429);

    // #when
    const fetching = fetchHfPointers(fetch, MONDAY);

    // #then
    await expect(fetching).rejects.toThrow("HF daily papers answered 429");
  });
});
