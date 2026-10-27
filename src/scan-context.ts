import { SOURCE_LABELS, type SourceName } from "./candidate.ts";
import { messageOf } from "./errors.ts";
import type { ScanLog } from "./log.ts";
import type { SourceResults } from "./store.ts";

/** One Scan's record id and log, and what failed without failing it: each source's result and the ranking batches lost. */
export type ScanContext = { scanId: number; log: ScanLog; sources: SourceResults; rankingFailures: string[] };

/** Records a failed source in the Scan's results and log; returns its error. */
export function recordFailedSource({ sources, log }: Pick<ScanContext, "sources" | "log">, source: SourceName, error: unknown): string {
  const message = messageOf(error);
  sources[source] = { error: message };
  log(`${SOURCE_LABELS[source]} failed: ${message}`);
  return message;
}
