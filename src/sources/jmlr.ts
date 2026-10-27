import type { Candidate } from "../candidate.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";
import { feedCandidates } from "./rss.ts";

const FEED = "https://www.jmlr.org/jmlr.xml";

/** The JMLR feed's Papers. Its dates are year-only, so a Paper's URL is its id and the store drops what it has seen. */
export async function fetchJmlrCandidates(fetch: Fetch): Promise<Candidate[]> {
  const response = await fetch(FEED);
  if (!response.ok) throw new PaperBotError(`JMLR answered ${response.status}`);
  return feedCandidates(await response.text(), "jmlr", FEED);
}
