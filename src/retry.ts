import { messageOf, PaperBotError } from "./errors.ts";
import type { Fetch } from "./http.ts";
import type { ScanLog } from "./log.ts";

/** The wait seam: retries wait only through it, so tests don't. */
export type Sleep = (ms: number) => Promise<void>;

export const systemSleep: Sleep = (ms) => Bun.sleep(ms);

export const RETRY_WAIT_MS = 30_000;

/** Runs `attempt`, and once more after a short wait when it fails with a PaperBotError. */
export async function retryOnce<T>(what: string, attempt: () => Promise<T>, sleep: Sleep, log: ScanLog): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof PaperBotError)) throw error;
    log(`${what} failed, retrying in ${RETRY_WAIT_MS / 1000}s: ${error.message}`);
    await sleep(RETRY_WAIT_MS);
    return await attempt();
  }
}

/** Fetches again once, after a short wait, when the first try throws or answers with an error status. */
export function retryingFetch(fetch: Fetch, sleep: Sleep, log: ScanLog): Fetch {
  return async (url) => {
    const host = new URL(url).host;
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      log(`${host} answered ${response.status}, retrying in ${RETRY_WAIT_MS / 1000}s`);
    } catch (error) {
      log(`${host} failed, retrying in ${RETRY_WAIT_MS / 1000}s: ${messageOf(error)}`);
    }
    await sleep(RETRY_WAIT_MS);
    return await fetch(url);
  };
}
