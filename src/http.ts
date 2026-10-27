import { PaperBotError } from "./errors.ts";

/** The HTTP seam every source fetches through, so tests serve recorded responses. */
export type Fetch = (url: string) => Promise<Response>;

const FETCH_TIMEOUT_MS = 60_000;

export const httpFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "paper-bot" } });

/** The response to `url`; an error status is a PaperBotError saying `source` answered it, naming `url` when asked to. */
export async function fetchOk(fetch: Fetch, url: string, source: string, { namingUrl = false } = {}): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new PaperBotError(`${source} answered ${response.status}${namingUrl ? ` for ${url}` : ""}`);
  return response;
}
