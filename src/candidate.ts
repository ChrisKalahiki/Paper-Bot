export type SourceName = "arxiv";

/**
 * A Paper fetched for ranking. `ids` is its id set, each prefixed by its kind (`arxiv:`, `doi:`); the first is the one
 * Briefings and prompts name it by.
 */
export type Candidate = {
  source: SourceName;
  ids: string[];
  title: string;
  url: string;
  abstract: string;
};

export function primaryId(candidate: Candidate): string {
  const [id] = candidate.ids;
  if (id === undefined) throw new Error(`Candidate "${candidate.title}" has no id`);
  return id;
}
