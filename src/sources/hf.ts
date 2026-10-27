import { arxivIds, type Pointers } from "../candidate.ts";
import { localDate } from "../clock.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";

const DAILY_PAPERS = "https://huggingface.co/api/daily_papers";

type DailyPaper = { paper?: { id?: string } };

/** The Papers on HF daily papers for the Scan's day, pointed at by their arXiv ids. */
export async function fetchHfPointers(fetch: Fetch, at: Date): Promise<Pointers> {
  const response = await fetch(`${DAILY_PAPERS}?date=${localDate(at)}`);
  if (!response.ok) throw new PaperBotError(`HF daily papers answered ${response.status}`);
  const listed = (await response.json()) as DailyPaper[];
  return {
    candidates: [],
    signals: listed.flatMap(({ paper }) => (paper?.id ? [{ ids: arxivIds(paper.id), text: "on HF daily papers" }] : [])),
  };
}
