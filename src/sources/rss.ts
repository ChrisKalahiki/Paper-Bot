import type { Candidate, SourceName } from "../candidate.ts";

/** One Candidate per feed item with a title and link, identified by its absolute link; HTML in the abstract becomes text. */
export function feedCandidates(xml: string, source: SourceName, base: string): Candidate[] {
  return rssItems(xml).flatMap((item) => {
    const title = collapse(element(item, "title") ?? "");
    const link = element(item, "link");
    if (title === "" || link === undefined || link === "") return [];
    const url = new URL(link, base).href;
    return [{ source, ids: [`url:${url}`], title, url, abstract: collapse(stripTags(element(item, "description") ?? "")) }];
  });
}

/** The body of each `<item>` in an RSS feed. */
export function rssItems(xml: string): string[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item = ""]) => item);
}

/** The body of each `<entry>` in an Atom feed. */
export function atomEntries(xml: string): string[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry = ""]) => entry);
}

/** The text of the first `<tag>` element, unwrapped from CDATA or with entities decoded. */
export function element(xml: string, tag: string): string | undefined {
  const text = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1];
  if (text === undefined) return undefined;
  const cdata = text.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)?.[1];
  return (cdata ?? decodeEntities(text)).trim();
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** HTML with each tag replaced by a space. */
export const stripTags = (html: string): string => html.replace(/<[^>]*>/g, " ");
