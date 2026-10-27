import type { Pointers } from "../candidate.ts";
import type { Fetch } from "../http.ts";
import { fetchPage, joinPointers, linksTo, pointAt, type Unread } from "./lab.ts";
import { collapse } from "./rss.ts";

const PUBLICATIONS = "https://deepmind.google/research/publications/";

/** The publications on the listing's first page that no earlier Scan read, each pointing at its Paper through JSON-LD `sameAs`. */
export async function fetchDeepMindPointers(fetch: Fetch, unread: Unread): Promise<Pointers> {
  const listing = await fetchPage(fetch, "deepmind", PUBLICATIONS);
  const publications = unread(linksTo(listing, PUBLICATIONS, /^\/research\/publications\/\d+\/?$/));
  const found = await Promise.all(
    publications.map(async (url) => {
      const article = scholarlyArticle(await fetchPage(fetch, "deepmind", url));
      return article === undefined ? { candidates: [], signals: [] } : pointAt("deepmind", article.link, article);
    }),
  );
  return { ...joinPointers(found), read: publications };
}

type Article = { link: string; title: string; abstract: string };

/** The first JSON-LD object on the page that links its Paper with `sameAs`; a publication with no link names no Paper. */
function scholarlyArticle(html: string): Article | undefined {
  for (const [, json = ""] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    for (const node of jsonLdNodes(json)) {
      const sameAs = Array.isArray(node.sameAs) ? node.sameAs[0] : node.sameAs;
      const title = node.headline ?? node.name;
      if (typeof sameAs !== "string" || typeof title !== "string") continue;
      const abstract = node.abstract ?? node.description;
      return { link: sameAs, title: collapse(title), abstract: typeof abstract === "string" ? collapse(abstract) : "" };
    }
  }
  return undefined;
}

type Node = Record<string, unknown>;

/** The objects of one JSON-LD block, from a single object, an array or an `@graph`; a block that isn't JSON has none. */
function jsonLdNodes(json: string): Node[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return nodesOf(parsed);
}

function nodesOf(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodesOf);
  if (typeof value !== "object" || value === null) return [];
  const node = value as Node;
  return Array.isArray(node["@graph"]) ? nodesOf(node["@graph"]) : [node];
}
