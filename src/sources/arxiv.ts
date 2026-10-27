import { arxivIds, type Candidate } from "../candidate.ts";
import { PaperBotError } from "../errors.ts";
import type { Fetch } from "../http.ts";
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
