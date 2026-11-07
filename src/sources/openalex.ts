import { arxivIdsInUrl, bareDoi, type Candidate, doiIds, SOURCE_LABELS } from "../candidate.ts";
import { localDate } from "../clock.ts";
import { type Fetch, fetchOk } from "../http.ts";
import { collapse } from "./rss.ts";

const WORKS = "https://api.openalex.org/works";

/** OpenAlex subfields: 3304 Education, 1709 Human-Computer Interaction. */
export const SUBFIELDS = ["3304", "1709"];

/** Publication dates lag and get backfilled, so each Scan re-reads a rolling window and the store drops what it has seen. */
export const WINDOW_DAYS = 14;

const OPENALEX_FIELDS = "id,doi,title,ids,primary_location,locations,best_oa_location,abstract_inverted_index,authorships";

export type OpenAlexOptions = {
  key: string;
  /** OpenAlex source ids of the watched Venues. */
  venues: string[];
  /** Venue names by OpenAlex source id: a work published in one is marked as accepted there. */
  names?: Record<string, string>;
  /** OpenAlex author ids of the Followed Groups' members. */
  authorIds?: string[];
};

export type Work = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  primary_location?: { landing_page_url?: string | null; source?: { id?: string } | null } | null;
  locations?: { landing_page_url?: string | null }[] | null;
  best_oa_location?: { pdf_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: { author?: { id?: string | null } | null }[] | null;
};

export type WorksPage = { meta?: { next_cursor?: string | null }; results?: Work[] };

/**
 * Works published in the last 14 days in Education or HCI or by a Followed Group's member, plus this and last year's
 * works from the watched Venues.
 */
export async function fetchOpenAlexCandidates(fetch: Fetch, options: OpenAlexOptions, at: Date): Promise<Candidate[]> {
  const from = new Date(at);
  from.setDate(from.getDate() - WINDOW_DAYS);
  const window = `from_publication_date:${localDate(from)},to_publication_date:${localDate(at)}`;
  const filters = [`primary_topic.subfield.id:${SUBFIELDS.join("|")},${window}`];
  if (options.authorIds !== undefined && options.authorIds.length > 0) filters.push(`authorships.author.id:${options.authorIds.join("|")},${window}`);
  if (options.venues.length > 0) {
    const year = at.getFullYear();
    filters.push(`primary_location.source.id:${options.venues.join("|")},publication_year:${year}|${year - 1}`);
  }
  const candidates: Candidate[] = [];
  for (const filter of filters) {
    for (const work of await allWorks(fetch, filter, options.key)) {
      const candidate = toCandidate(work, options.names ?? {});
      if (candidate !== undefined) candidates.push(candidate);
    }
  }
  return candidates;
}

async function allWorks(fetch: Fetch, filter: string, key: string): Promise<Work[]> {
  const works: Work[] = [];
  let cursor: string | null | undefined = "*";
  while (cursor) {
    const page = await fetchWorksPage(fetch, filter, { cursor, key });
    const results = page.results ?? [];
    works.push(...results);
    cursor = results.length > 0 ? page.meta?.next_cursor : null;
  }
  return works;
}

/** One page of the works matching `filter`, up to 200; `cursor` pages through them, and `key` is the API key, if any. */
export async function fetchWorksPage(fetch: Fetch, filter: string, { cursor, key }: { cursor?: string; key?: string } = {}): Promise<WorksPage> {
  const params = new URLSearchParams({ filter, select: OPENALEX_FIELDS, "per-page": "200", ...(cursor !== undefined && { cursor }), ...(key !== undefined && { api_key: key }) });
  return (await (await fetchOk(fetch, `${WORKS}?${params}`, SOURCE_LABELS.openalex)).json()) as WorksPage;
}

export function toCandidate(work: Work, names: Record<string, string>): Candidate | undefined {
  const title = collapse(work.title ?? "");
  const openalex = work.id?.match(/W\d+$/)?.[0];
  if (!title || openalex === undefined) return undefined;
  const doi = work.doi ? doiIds(work.doi) : [];
  const venue = names[work.primary_location?.source?.id?.match(/S\d+$/)?.[0] ?? ""];
  const authorIds = (work.authorships ?? []).flatMap((authorship) => authorIdOf(authorship.author?.id) ?? []);
  const preprints = (work.locations ?? []).flatMap((location) => (location.landing_page_url ? arxivIdsInUrl(location.landing_page_url) : []));
  return {
    source: "openalex",
    ids: [...new Set([...doi, ...preprints, `openalex:${openalex}`])],
    title,
    url: work.doi ? `https://doi.org/${bareDoi(work.doi)}` : (work.primary_location?.landing_page_url ?? `https://openalex.org/${openalex}`),
    abstract: abstractOf(work.abstract_inverted_index),
    ...(work.best_oa_location?.pdf_url ? { pdf: work.best_oa_location.pdf_url } : {}),
    ...(venue === undefined ? {} : { signals: [`accepted at ${venue}`] }),
    ...(authorIds.length > 0 && { authorIds }),
  };
}

/** The bare author id, such as `A5012345678`, of an OpenAlex author URL. */
export const authorIdOf = (url: string | null | undefined): string | undefined => url?.match(/A\d+$/)?.[0];

/** OpenAlex ships abstracts only as word → positions; this puts the words back in order. */
function abstractOf(index: Work["abstract_inverted_index"]): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return collapse(words.filter((word) => word !== undefined).join(" "));
}
