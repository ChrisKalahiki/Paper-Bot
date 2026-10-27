import { arxivIdsInUrl, bareDoi, type Candidate, doiIds } from "../candidate.ts";
import { localDate } from "../clock.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";

const WORKS = "https://api.openalex.org/works";

/** OpenAlex subfields: 3304 Education, 1709 Human-Computer Interaction. */
const SUBFIELDS = ["3304", "1709"];

/** Publication dates lag and get backfilled, so each Scan re-reads a rolling window and the store drops what it has seen. */
const WINDOW_DAYS = 14;

const FIELDS = "id,doi,title,ids,primary_location,locations,abstract_inverted_index";

export type OpenAlexOptions = { key: string; /** OpenAlex source ids of the watched Venues. */ venues: string[] };

type Work = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  primary_location?: { landing_page_url?: string | null } | null;
  locations?: { landing_page_url?: string | null }[] | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

type Page = { meta?: { next_cursor?: string | null }; results?: Work[] };

/** Works published in the last 14 days in Education or HCI, plus this and last year's works from the watched Venues. */
export async function fetchOpenAlexCandidates(fetch: Fetch, options: OpenAlexOptions, at: Date): Promise<Candidate[]> {
  const from = new Date(at);
  from.setDate(from.getDate() - WINDOW_DAYS);
  const filters = [`primary_topic.subfield.id:${SUBFIELDS.join("|")},from_publication_date:${localDate(from)},to_publication_date:${localDate(at)}`];
  if (options.venues.length > 0) {
    const year = at.getFullYear();
    filters.push(`primary_location.source.id:${options.venues.join("|")},publication_year:${year}|${year - 1}`);
  }
  const candidates: Candidate[] = [];
  for (const filter of filters) {
    for (const work of await allWorks(fetch, filter, options.key)) {
      const candidate = toCandidate(work);
      if (candidate !== undefined) candidates.push(candidate);
    }
  }
  return candidates;
}

async function allWorks(fetch: Fetch, filter: string, key: string): Promise<Work[]> {
  const works: Work[] = [];
  let cursor: string | null | undefined = "*";
  while (cursor) {
    const params = new URLSearchParams({ filter, select: FIELDS, "per-page": "200", cursor, api_key: key });
    const response = await fetch(`${WORKS}?${params}`);
    if (!response.ok) throw new PaperBotError(`OpenAlex answered ${response.status}`);
    const page = (await response.json()) as Page;
    const results = page.results ?? [];
    works.push(...results);
    cursor = results.length > 0 ? page.meta?.next_cursor : null;
  }
  return works;
}

function toCandidate(work: Work): Candidate | undefined {
  const title = work.title?.replace(/\s+/g, " ").trim();
  const openalex = work.id?.match(/W\d+$/)?.[0];
  if (!title || openalex === undefined) return undefined;
  const doi = work.doi ? doiIds(work.doi) : [];
  const preprints = (work.locations ?? []).flatMap((location) => (location.landing_page_url ? arxivIdsInUrl(location.landing_page_url) : []));
  return {
    source: "openalex",
    ids: [...new Set([...doi, ...preprints, `openalex:${openalex}`])],
    title,
    url: work.doi ? `https://doi.org/${bareDoi(work.doi)}` : (work.primary_location?.landing_page_url ?? `https://openalex.org/${openalex}`),
    abstract: abstractOf(work.abstract_inverted_index),
  };
}

/** OpenAlex ships abstracts only as word → positions; this puts the words back in order. */
function abstractOf(index: Work["abstract_inverted_index"]): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.filter((word) => word !== undefined).join(" ").replace(/\s+/g, " ").trim();
}
