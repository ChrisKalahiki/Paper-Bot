import { type Candidate, SOURCE_LABELS } from "../candidate.ts";
import { type Fetch, fetchOk } from "../http.ts";
import { feedCandidates } from "./rss.ts";

const FEED = "https://www.jmlr.org/jmlr.xml";

/** The JMLR feed's Papers. Its dates are year-only, so a Paper's URL is its id and the store drops what it has seen. */
export async function fetchJmlrCandidates(fetch: Fetch): Promise<Candidate[]> {
  const response = await fetchOk(fetch, FEED, SOURCE_LABELS.jmlr);
  return feedCandidates(await response.text(), "jmlr", FEED);
}
