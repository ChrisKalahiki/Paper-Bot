import { type Candidate, type PointerName, type Pointers, type Signal, SOURCE_LABELS } from "./candidate.ts";
import { messageOf } from "./errors.ts";
import type { Fetch } from "./http.ts";
import type { ScanLog } from "./log.ts";
import { fetchHfPointers } from "./sources/hf.ts";
import type { SourceResults } from "./store.ts";

export type PointerDeps = { fetch: Fetch; at: Date };

/** Every pointer's Signals and lab Papers. A failed pointer is recorded and skipped; it never fails the Scan. */
export async function fetchPointers(deps: PointerDeps, results: SourceResults, log: ScanLog): Promise<Pointers> {
  const pointers: Record<PointerName, () => Promise<Pointers>> = {
    hf: () => fetchHfPointers(deps.fetch, deps.at),
  };
  const fetched = await Promise.all(
    (Object.entries(pointers) as [PointerName, () => Promise<Pointers>][]).map(async ([name, fetchPointer]): Promise<Pointers> => {
      try {
        const found = await fetchPointer();
        results[name] = { candidates: found.candidates.length };
        log(`${SOURCE_LABELS[name]}: ${found.signals.length} signals, ${found.candidates.length} Candidates`);
        return found;
      } catch (error) {
        results[name] = { error: messageOf(error) };
        log(`${SOURCE_LABELS[name]} failed: ${messageOf(error)}`);
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
