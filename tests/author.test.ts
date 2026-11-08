import { describe, expect, test } from "bun:test";
import { findAuthors } from "../src/author.ts";

const AUTHORS = JSON.stringify({
  results: [
    {
      id: "https://openalex.org/A5012345678",
      display_name: "Kenneth R. Koedinger",
      works_count: 812,
      last_known_institutions: [{ display_name: "Carnegie Mellon University" }],
    },
    { id: "https://openalex.org/A5011111111", display_name: "K. Koedinger", works_count: 3, last_known_institutions: [] },
  ],
});

const worksOf = (...titles: [string, number][]) => JSON.stringify({ results: titles.map(([title, publication_year]) => ({ title, publication_year })) });

function recording(answer: (url: URL) => string) {
  const requested: URL[] = [];
  const fetch = async (url: string) => {
    requested.push(new URL(url));
    return new Response(answer(new URL(url)));
  };
  return { fetch, requested };
}

const serving = (url: URL): string =>
  url.pathname === "/authors"
    ? AUTHORS
    : url.searchParams.get("filter") === "authorships.author.id:A5012345678"
      ? worksOf(["Tutors That Fade", 2026], ["Learning Curves Revisited", 2025])
      : worksOf();

describe("paper-bot author", () => {
  test("lists each matching OpenAlex author as a Followed Group member line, with affiliations, works and recent Paper titles", async () => {
    // #given
    const { fetch } = recording(serving);

    // #when
    const listing = await findAuthors(fetch, "Koedinger", "KEY");

    // #then
    expect(listing).toBe(`Kenneth R. Koedinger (A5012345678) · Carnegie Mellon University · 812 works
  - 2026 Tutors That Fade
  - 2025 Learning Curves Revisited
K. Koedinger (A5011111111) · no known affiliation · 3 works
`);
  });

  test("searches OpenAlex's authors by name, then asks for each one's most recent works, with the key", async () => {
    // #given
    const { fetch, requested } = recording(serving);

    // #when
    await findAuthors(fetch, "Koedinger", "KEY");

    // #then
    expect(requested.map((url): Record<string, string> => ({ path: url.pathname, ...Object.fromEntries(url.searchParams) }))).toEqual([
      { path: "/authors", search: "Koedinger", "per-page": "10", select: "id,display_name,works_count,last_known_institutions", api_key: "KEY" },
      {
        path: "/works",
        filter: "authorships.author.id:A5012345678",
        sort: "publication_date:desc",
        "per-page": "3",
        select: "title,publication_year",
        api_key: "KEY",
      },
      {
        path: "/works",
        filter: "authorships.author.id:A5011111111",
        sort: "publication_date:desc",
        "per-page": "3",
        select: "title,publication_year",
        api_key: "KEY",
      },
    ]);
  });

  test("fails, naming the search, when OpenAlex knows no such author", async () => {
    // #given
    const { fetch } = recording(() => JSON.stringify({ results: [] }));

    // #when
    const finding = findAuthors(fetch, "Nobody Atall", "KEY");

    // #then
    await expect(finding).rejects.toThrow('OpenAlex knows no author named "Nobody Atall"');
  });
});
