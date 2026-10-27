/** The HTTP seam every source fetches through, so tests serve recorded responses. */
export type Fetch = (url: string) => Promise<Response>;

const FETCH_TIMEOUT_MS = 60_000;

export const httpFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "paper-bot" } });
