import { type LabName, linkIds, type Pointers, SOURCE_LABELS } from "../candidate.ts";
import { type Fetch, fetchOk } from "../http.ts";

/** The lab post URLs, of those given, that no earlier Scan has read. */
export type Unread = (urls: string[]) => string[];

export const announcedBy = (lab: LabName): string => `announced by ${SOURCE_LABELS[lab]}`;

/** A lab's link to its Paper: a Signal when the link names an arXiv id or DOI, else the Paper as a Candidate identified by the link. */
export function pointAt(lab: LabName, link: string, paper: { title: string; abstract: string }): Pointers {
  const text = announcedBy(lab);
  const ids = linkIds(link);
  if (ids.length > 0) return { candidates: [], signals: [{ ids, text }] };
  return { candidates: [{ source: lab, ids: [`url:${link}`], title: paper.title, url: link, abstract: paper.abstract, signals: [text] }], signals: [] };
}

export async function fetchPage(fetch: Fetch, lab: LabName, url: string): Promise<string> {
  return (await fetchOk(fetch, url, SOURCE_LABELS[lab], { namingUrl: true })).text();
}

export function joinPointers(found: Pointers[]): Pointers {
  return {
    candidates: found.flatMap(({ candidates }) => candidates),
    signals: found.flatMap(({ signals }) => signals),
    read: found.flatMap(({ read }) => read ?? []),
  };
}

/** Every distinct absolute URL among the page's links whose path matches `path`, in page order. */
export function linksTo(html: string, base: string, path: RegExp): string[] {
  const urls = [...html.matchAll(/href="([^"]+)"/g)].flatMap(([, href = ""]) => {
    if (!URL.canParse(href, base)) return [];
    const url = new URL(href, base);
    return path.test(url.pathname) ? [url.href] : [];
  });
  return [...new Set(urls)];
}
