import { SOURCE_LABELS } from "./candidate.ts";
import { PaperBotError } from "./errors.ts";
import { type Fetch, fetchOk } from "./http.ts";
import { authorIdOf } from "./sources/openalex.ts";
import { collapse } from "./sources/rss.ts";

const OPENALEX = "https://api.openalex.org";
const MATCHES = 10;
const RECENT_WORKS = 3;

type Author = { id?: string; display_name?: string | null; works_count?: number; last_known_institutions?: { display_name?: string | null }[] | null };
type RecentWork = { title?: string | null; publication_year?: number | null };

/**
 * The OpenAlex authors matching `name`, for choosing a Followed Group member's ids: each as a member line to paste into
 * the Interests Note, with their affiliations, how many works they have and their most recent Paper titles.
 */
export async function findAuthors(fetch: Fetch, name: string, key: string): Promise<string> {
  const ask = async <T>(path: string, params: Record<string, string>): Promise<T[]> => {
    const url = `${OPENALEX}${path}?${new URLSearchParams({ ...params, api_key: key })}`;
    return ((await (await fetchOk(fetch, url, SOURCE_LABELS.openalex)).json()) as { results?: T[] }).results ?? [];
  };
  const authors = (await ask<Author>("/authors", { search: name, "per-page": String(MATCHES), select: "id,display_name,works_count,last_known_institutions" })).flatMap(
    (author) => {
      const id = authorIdOf(author.id);
      return id === undefined ? [] : [{ ...author, id }];
    },
  );
  if (authors.length === 0) throw new PaperBotError(`OpenAlex knows no author named "${name}"`);
  const listed: string[] = [];
  for (const author of authors) {
    const works = await ask<RecentWork>("/works", {
      filter: `authorships.author.id:${author.id}`,
      sort: "publication_date:desc",
      "per-page": String(RECENT_WORKS),
      select: "title,publication_year",
    });
    const affiliations = (author.last_known_institutions ?? []).flatMap((institution) => institution.display_name ?? []).join(", ") || "no known affiliation";
    listed.push(
      [
        `${author.display_name ?? "Unnamed"} (${author.id}) · ${affiliations} · ${author.works_count ?? 0} works`,
        ...works.flatMap((work) => (work.title ? [`  - ${work.publication_year ?? "????"} ${collapse(work.title)}`] : [])),
      ].join("\n"),
    );
  }
  return `${listed.join("\n")}\n`;
}
