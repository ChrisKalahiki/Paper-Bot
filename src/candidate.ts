export const SOURCE_LABELS = { arxiv: "arXiv", openalex: "OpenAlex", eric: "ERIC", pmlr: "PMLR", jmlr: "JMLR" } as const;

export type SourceName = keyof typeof SOURCE_LABELS;

/**
 * A Paper fetched for ranking. `ids` is its id set, each prefixed by its kind (`arxiv:`, `doi:`, `openalex:`, `eric:`,
 * `url:`); the first is the one Briefings and prompts name it by. `abstract` is empty when the source has none.
 */
export type Candidate = {
  source: SourceName;
  ids: string[];
  title: string;
  url: string;
  abstract: string;
};

/** An arXiv Paper's ids: its arXiv id without the version, and the DOI arXiv registers for it. */
export function arxivIds(id: string): string[] {
  const bare = id.replace(/v\d+$/, "");
  return [`arxiv:${bare}`, `doi:10.48550/arxiv.${bare.toLowerCase()}`];
}

/** A DOI lowercased, without a resolver prefix such as `https://doi.org/` or `http://dx.doi.org/`. */
export function bareDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

/** A DOI's ids; an arXiv DOI also gives its arXiv id. */
export function doiIds(doi: string): string[] {
  const bare = bareDoi(doi);
  const arxiv = bare.match(/^10\.48550\/arxiv\.(.+)$/)?.[1];
  return arxiv === undefined ? [`doi:${bare}`] : arxivIds(arxiv);
}

/** The arXiv ids in an arxiv.org abstract or PDF link, if it is one. */
export function arxivIdsInUrl(url: string): string[] {
  const id = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/)?.[1];
  return id === undefined ? [] : arxivIds(id);
}

export function primaryId(candidate: Candidate): string {
  const [id] = candidate.ids;
  if (id === undefined) throw new Error(`Candidate "${candidate.title}" has no id`);
  return id;
}

/** How the ranker judged one Candidate against the Interests. */
export type Ranking = { interests: string[]; score: number; why: string; wildcard: boolean };
