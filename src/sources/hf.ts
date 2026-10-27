import { arxivIds, type Pointers, SOURCE_LABELS } from "../candidate.ts";
import { localDate } from "../clock.ts";
import { type Fetch, fetchOk } from "../http.ts";

const DAILY_PAPERS = "https://huggingface.co/api/daily_papers";

type DailyPaper = { paper?: { id?: string } };

/** The Papers on HF daily papers for the Scan's day, pointed at by their arXiv ids. */
export async function fetchHfPointers(fetch: Fetch, at: Date): Promise<Pointers> {
  const response = await fetchOk(fetch, `${DAILY_PAPERS}?date=${localDate(at)}`, SOURCE_LABELS.hf);
  const listed = (await response.json()) as DailyPaper[];
  return {
    candidates: [],
    signals: listed.flatMap(({ paper }) => (paper?.id ? [{ ids: arxivIds(paper.id), text: "on HF daily papers" }] : [])),
  };
}
