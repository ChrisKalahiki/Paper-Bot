import { type Candidate, SOURCE_LABELS } from "../candidate.ts";
import { type Fetch, fetchOk } from "../http.ts";
import { element, feedCandidates, rssItems } from "./rss.ts";

const BASE = "https://proceedings.mlr.press/";

/**
 * The Papers of the newest ICML volume, which OpenAlex lacks. PMLR issues no DOIs, so a Paper's PMLR URL is its id; the
 * store drops the volume's Papers once ranked.
 */
export async function fetchPmlrCandidates(fetch: Fetch): Promise<Candidate[]> {
  const volume = newestIcmlVolume(await feed(fetch, `${BASE}feed.xml`));
  if (volume === undefined) return [];
  return feedCandidates(await feed(fetch, `${BASE}v${volume}/assets/rss/feed.xml`), "pmlr", BASE);
}

function newestIcmlVolume(xml: string): number | undefined {
  const volumes = rssItems(xml).flatMap((item) => {
    if (!/\bICML\b|International Conference on Machine Learning/.test(element(item, "title") ?? "")) return [];
    const volume = element(item, "link")?.match(/\/v(\d+)\/?$/)?.[1];
    return volume === undefined ? [] : [Number(volume)];
  });
  return volumes.length === 0 ? undefined : Math.max(...volumes);
}

async function feed(fetch: Fetch, url: string): Promise<string> {
  return (await fetchOk(fetch, url, SOURCE_LABELS.pmlr)).text();
}
