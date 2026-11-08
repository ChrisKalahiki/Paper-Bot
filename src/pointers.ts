import { type Candidate, type PointerName, type Pointers, type Signal, SOURCE_LABELS } from "./candidate.ts";
import type { Fetch } from "./http.ts";
import { fetchAnthropicPointers } from "./sources/anthropic.ts";
import { fetchDeepMindPointers } from "./sources/deepmind.ts";
import { fetchHfPointers } from "./sources/hf.ts";
import { fetchOpenAiPointers } from "./sources/openai.ts";
import { recordFailedSource, type ScanContext } from "./scan-context.ts";
import type { Store } from "./store.ts";

/** `days` are those the Scan covers, today last: HF daily papers is read for each. */
export type PointerDeps = { fetch: Fetch; store: Pick<Store, "unreadPosts" | "markPostsRead">; at: Date; days: Date[] };

/**
 * Every pointer's Signals and lab Papers. A failed pointer is recorded and skipped, never failing the Scan, and the lab
 * posts it read stay unread for the next Scan.
 */
export async function fetchPointers({ fetch, store, at, days }: PointerDeps, scan: Pick<ScanContext, "sources" | "log">): Promise<Pointers> {
  const unread = (urls: string[]) => store.unreadPosts(urls);
  const pointers: Record<PointerName, () => Promise<Pointers>> = {
    hf: async () => {
      const signals = [];
      for (const day of days) signals.push(...(await fetchHfPointers(fetch, day)).signals);
      return { candidates: [], signals };
    },
    deepmind: () => fetchDeepMindPointers(fetch, unread),
    anthropic: () => fetchAnthropicPointers(fetch, unread, at),
    openai: () => fetchOpenAiPointers(fetch),
  };
  const fetched = await Promise.all(
    (Object.entries(pointers) as [PointerName, () => Promise<Pointers>][]).map(async ([name, fetchPointer]): Promise<Pointers> => {
      try {
        const found = await fetchPointer();
        store.markPostsRead(found.read ?? [], at);
        scan.sources[name] = { candidates: found.candidates.length };
        scan.log(`${SOURCE_LABELS[name]}: ${found.signals.length} signals, ${found.candidates.length} Candidates`);
        return found;
      } catch (error) {
        recordFailedSource(scan, name, error);
        return { candidates: [], signals: [] };
      }
    }),
  );
  return { candidates: fetched.flatMap(({ candidates }) => candidates), signals: fetched.flatMap(({ signals }) => signals) };
}

/** Each Candidate with the text of every Signal that points at it, by a shared id or the same title. */
export function withSignals(candidates: Candidate[], signals: Signal[]): Candidate[] {
  return candidates.map((candidate) => {
    const ids = new Set(candidate.ids);
    const title = comparable(candidate.title);
    const texts = signals.filter((signal) => ("ids" in signal ? signal.ids.some((id) => ids.has(id)) : comparable(signal.title) === title)).map(({ text }) => text);
    const all = [...new Set([...(candidate.signals ?? []), ...texts])];
    return all.length === 0 ? candidate : { ...candidate, signals: all };
  });
}

const comparable = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
