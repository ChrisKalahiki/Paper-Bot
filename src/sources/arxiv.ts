import { arxivIds, type Candidate } from "../candidate.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";
import type { Sleep } from "../retry.ts";
import { collapse, element, rssItems } from "./rss.ts";

const RSS_BASE = "https://rss.arxiv.org/rss/";

/** Announce types of Papers new to arXiv today; `replace` and `replace-cross` are revisions of older ones. */
const KEPT_ANNOUNCE_TYPES = new Set(["new", "cross"]);

/** Today's announcement for the categories, from one combined feed. */
export async function fetchArxivCandidates(fetch: Fetch, categories: string[]): Promise<Candidate[]> {
  const response = await fetch(`${RSS_BASE}${categories.join("+")}`);
  if (!response.ok) throw new PaperBotError(`arXiv RSS answered ${response.status}`);
  return parseArxivRss(await response.text());
}

const API_BASE = "https://export.arxiv.org/api/query";
const API_PAGE = 2000;
/** arXiv asks for at most one API request every 3 s. */
const API_INTERVAL_MS = 3000;

/**
 * Every Paper in the categories submitted in the window, from the query API, oldest first. Revisions keep their first
 * submission date, so the window holds only Papers new to arXiv in it.
 */
export async function fetchArxivSubmitted(fetch: Fetch, categories: string[], window: { from: Date; to: Date }, sleep: Sleep): Promise<Candidate[]> {
  const query = `%28${categories.map((category) => `cat:${category}`).join("+OR+")}%29+AND+submittedDate:[${apiTime(window.from)}+TO+${apiTime(window.to)}]`;
  const candidates: Candidate[] = [];
  for (let start = 0; ; start += API_PAGE) {
    if (start > 0) await sleep(API_INTERVAL_MS);
    const response = await fetch(`${API_BASE}?search_query=${query}&sortBy=submittedDate&sortOrder=ascending&start=${start}&max_results=${API_PAGE}`);
    if (!response.ok) throw new PaperBotError(`arXiv API answered ${response.status}`);
    const xml = await response.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry = ""]) => entry);
    candidates.push(...entries.flatMap(apiCandidate));
    const total = Number(element(xml, "opensearch:totalResults") ?? 0);
    if (entries.length === 0 || start + entries.length >= total) return candidates;
  }
}

/** `YYYYMMDDHHMM` in GMT, as `submittedDate` takes it. */
const apiTime = (at: Date): string => at.toISOString().slice(0, 16).replace(/\D/g, "");

function apiCandidate(entry: string): Candidate[] {
  const id = element(entry, "id")?.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/)?.[1];
  const title = element(entry, "title");
  if (id === undefined || title === undefined) return [];
  return [
    {
      source: "arxiv",
      ids: arxivIds(id),
      title: collapse(title),
      authors: [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map(([, author = ""]) => collapse(element(author, "name") ?? "")).filter((name) => name !== ""),
      url: `https://arxiv.org/abs/${id}`,
      abstract: collapse(element(entry, "summary") ?? ""),
    },
  ];
}

function parseArxivRss(xml: string): Candidate[] {
  return rssItems(xml).flatMap((item) => {
    const announceType = element(item, "arxiv:announce_type");
    const link = element(item, "link");
    const id = link?.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/)?.[1];
    const title = element(item, "title");
    if (announceType === undefined || !KEPT_ANNOUNCE_TYPES.has(announceType) || link === undefined || id === undefined || title === undefined) return [];
    return [
      {
        source: "arxiv" as const,
        ids: arxivIds(id),
        title: collapse(title),
        authors: (element(item, "dc:creator") ?? "").split(",").map(collapse).filter((name) => name !== ""),
        url: link,
        abstract: collapse((element(item, "description") ?? "").replace(/^[\s\S]*?Abstract:/, "")),
      },
    ];
  });
}
