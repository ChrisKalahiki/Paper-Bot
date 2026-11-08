import { type Candidate, linkIds, type Pointers } from "../candidate.ts";
import { DAY_MS } from "../clock.ts";
import type { Fetch } from "../http.ts";
import { announcedBy, fetchPage, joinPointers, linksTo, pointAt, type Unread } from "./lab.ts";
import { atomEntries, collapse, decodeEntities, element, stripTags } from "./rss.ts";

const RESEARCH = "https://www.anthropic.com/research";
const CIRCUITS_FEED = "https://transformer-circuits.pub/feed.xml";

/** transformer-circuits.pub dates its articles, so each Scan re-reads a window and the store drops what it has seen. */
const WINDOW_DAYS = 14;

/**
 * The research posts on /research that no earlier Scan read, each pointing at the first Paper it links, plus the
 * transformer-circuits.pub articles of the last 14 days, which are Papers of their own.
 */
export async function fetchAnthropicPointers(fetch: Fetch, unread: Unread, at: Date): Promise<Pointers> {
  const [circuits, posts] = await Promise.all([fetchCircuits(fetch, at), fetchPosts(fetch, unread)]);
  return joinPointers([{ candidates: circuits, signals: [] }, posts]);
}

async function fetchCircuits(fetch: Fetch, at: Date): Promise<Candidate[]> {
  const since = at.getTime() - WINDOW_DAYS * DAY_MS;
  const feed = await fetchPage(fetch, "anthropic", CIRCUITS_FEED);
  return atomEntries(feed).flatMap((entry) => {
    const title = collapse(element(entry, "title") ?? "");
    const link = entry.match(/<link\s[^>]*href="([^"]+)"/)?.[1];
    const date = Date.parse(element(entry, "published") ?? element(entry, "updated") ?? "");
    if (title === "" || link === undefined || !(date >= since)) return [];
    const abstract = collapse(stripTags(element(entry, "summary") ?? ""));
    return [{ source: "anthropic" as const, ids: [`url:${link}`], title, url: link, abstract, signals: [announcedBy("anthropic")] }];
  });
}

async function fetchPosts(fetch: Fetch, unread: Unread): Promise<Pointers> {
  const posts = unread(linksTo(await fetchPage(fetch, "anthropic", RESEARCH), RESEARCH, /^\/research\/[^/]+$/));
  const found = await Promise.all(
    posts.map(async (url) => {
      const html = await fetchPage(fetch, "anthropic", url);
      const link = linksTo(html, url, /.*/).find(isPaperLink);
      return link === undefined ? { candidates: [], signals: [] } : pointAt("anthropic", link, { title: meta(html, "og:title") ?? collapse(element(html, "title") ?? ""), abstract: meta(html, "description") ?? "" });
    }),
  );
  return { ...joinPointers(found), read: posts };
}

/** A link to a Paper: one naming an arXiv id or DOI, a PDF, or a transformer-circuits.pub article. */
const isPaperLink = (url: string): boolean => linkIds(url).length > 0 || new URL(url).pathname.endsWith(".pdf") || new URL(url).hostname === "transformer-circuits.pub";

function meta(html: string, name: string): string | undefined {
  const tag = [...html.matchAll(/<meta\s[^>]*>/g)].map(([tag]) => tag).find((tag) => tag.includes(`"${name}"`));
  const content = tag?.match(/content="([^"]*)"/)?.[1];
  return content === undefined ? undefined : collapse(decodeEntities(content));
}
