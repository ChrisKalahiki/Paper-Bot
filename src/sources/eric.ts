import { type Candidate, doiIds } from "../candidate.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";
import { collapse } from "./rss.ts";

const API = "https://api.ies.ed.gov/eric/";

/** ERIC's most rows per request. */
const ROWS = 2000;

type EricRecord = { id?: string; title?: string; description?: string; url?: string };

type Page = { response?: { numFound?: number; docs?: EricRecord[] } };

/**
 * Every Higher Education record added this year, and last year too in January. ERIC knows only the year a record was
 * added, so each Scan re-pulls the year and the store drops what it has seen.
 */
export async function fetchEricCandidates(fetch: Fetch, at: Date): Promise<Candidate[]> {
  const year = at.getFullYear();
  const years = at.getMonth() === 0 ? `(${year} OR ${year - 1})` : `${year}`;
  const search = `educationlevel:"Higher Education" AND e_yearadded:${years}`;
  const records: EricRecord[] = [];
  for (let start = 0; ; start += ROWS) {
    const params = new URLSearchParams({ search, format: "json", rows: String(ROWS), start: String(start) });
    const response = await fetch(`${API}?${params}`);
    if (!response.ok) throw new PaperBotError(`ERIC answered ${response.status}`);
    const page = (await response.json()) as Page;
    const docs = page.response?.docs ?? [];
    records.push(...docs);
    if (docs.length === 0 || start + ROWS >= (page.response?.numFound ?? 0)) break;
  }
  return records.flatMap(toCandidate);
}

function toCandidate(record: EricRecord): Candidate[] {
  const title = record.title === undefined ? "" : collapse(record.title);
  if (record.id === undefined || title === "") return [];
  const doi = record.url?.match(/doi\.org\/(10\..+)$/)?.[1];
  return [
    {
      source: "eric",
      ids: [...(doi === undefined ? [] : doiIds(doi)), `eric:${record.id}`],
      title,
      url: `https://eric.ed.gov/?id=${record.id}`,
      abstract: collapse(record.description ?? ""),
    },
  ];
}
