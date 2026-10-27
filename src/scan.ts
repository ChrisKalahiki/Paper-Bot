import { type BrainDump, brainDumpCli } from "./brain-dump.ts";
import { dailyBriefingPath, renderDailyBriefing } from "./briefing.ts";
import { type Candidate, mergeCandidates, type PaperSourceName, primaryId, type Ranking, SOURCE_LABELS } from "./candidate.ts";
import { type Clock, localDate } from "./clock.ts";
import type { Exec } from "./command.ts";
import type { Config } from "./config.ts";
import { messageOf, PaperBotError } from "./errors.ts";
import type { Fetch } from "./http.ts";
import { INTERESTS_NOTE, type InterestsNote, parseInterestsNote } from "./interests.ts";
import { keepTicked } from "./keep.ts";
import { openScanLog, type ScanLog } from "./log.ts";
import { fetchPointers, withSignals } from "./pointers.ts";
import type { PickInput } from "./prompts.ts";
import { codexRanker, type Ranker } from "./rank.ts";
import { fetchArxivCandidates } from "./sources/arxiv.ts";
import { fetchEricCandidates } from "./sources/eric.ts";
import { fetchJmlrCandidates } from "./sources/jmlr.ts";
import { fetchOpenAlexCandidates } from "./sources/openalex.ts";
import { fetchPmlrCandidates } from "./sources/pmlr.ts";
import type { Outcome, SourceResults, Store } from "./store.ts";
import { claudeWriter } from "./write.ts";

const MAX_PICKS = 5;

/** Everything a Scan touches outside itself, so tests can run the real pipeline against fakes. */
export type ScanDeps = { config: Config; store: Store; fetch: Fetch; exec: Exec; clock: Clock; logDir: string };

export type ScanResult = { outcome: Outcome; reason?: string; briefing?: string };

/**
 * Reads the Interests, fetches and ranks today's Candidates, and writes a Daily Briefing of the Picks.
 * The Scan is skipped when nothing clears the bar, and failed when it cannot settle its Briefing.
 */
export async function dailyScan(deps: ScanDeps): Promise<ScanResult> {
  const { config, store, clock } = deps;
  const log = openScanLog(deps.logDir, "daily", clock);
  const startedAt = clock();
  const scanId = store.startScan("daily", localDate(startedAt), startedAt);
  const sources: SourceResults = {};
  log(`Daily Scan ${scanId} started`);

  const settle = (result: ScanResult, picks: Parameters<Store["settleScan"]>[2] = []): ScanResult => {
    store.settleScan(scanId, { ...result, sources, at: clock() }, picks);
    log(`Daily Scan ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
    return result;
  };

  try {
    const brainDump = brainDumpCli(deps.exec, config.brainDump);
    const keepIssues = await keepTicked(deps, brainDump, scanId, log);
    const note = await readInterests(brainDump, Object.keys(config.venues));
    log(`Interests: ${note.interests.map((interest) => interest.name).join("; ")}`);
    for (const issue of note.issues) log(`Interests Note issue: ${issue}`);

    const [fetched, pointers] = await Promise.all([
      fetchSources(deps, watchedVenues(note, config.venues), sources, log),
      fetchPointers({ fetch: deps.fetch, store, at: startedAt }, sources, log),
    ]);
    const candidates = withSignals(dropKnown([...fetched, ...pointers.candidates], store, log), pointers.signals);
    log(`${candidates.length} new Candidates of ${fetched.length} fetched`);
    if (candidates.length === 0) return settle({ outcome: "skipped", reason: "no new Candidates" });

    const ranked = await rankAll(codexRanker(deps.exec, config.models.rank), candidates, note, deps, scanId, log);
    const picks = choosePicks(ranked, config.bars, note.wildcards.cap);
    if (picks.length === 0) return settle({ outcome: "skipped", reason: `no Candidate scored ${config.bars.pick} or above` });

    const prose = await claudeWriter(deps.exec, config.models.write)(picks, note.interests, startedAt);
    const rendered = picks.map(({ candidate, ranking }) => {
      const written = prose.picks.get(primaryId(candidate));
      if (written === undefined) throw new PaperBotError(`no prose for ${primaryId(candidate)}`);
      return { candidate, interests: ranking.interests, wildcard: ranking.wildcard, ...written };
    });
    const markdown = renderDailyBriefing({
      at: startedAt,
      take: prose.take,
      picks: rendered,
      candidates: countBySource(ranked),
      issues: note.issues,
      keepIssues,
    });
    const briefing = await brainDump.writeBriefing(dailyBriefingPath(startedAt), markdown);
    log(`wrote ${briefing}`);
    return settle(
      { outcome: "written", briefing },
      rendered.map((pick, i) => ({ candidate: pick.candidate, rank: i + 1, why: pick.why, summary: pick.summary })),
    );
  } catch (error) {
    if (!(error instanceof PaperBotError)) {
      log(`Daily Scan crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      throw error;
    }
    return settle({ outcome: "failed", reason: error.message });
  }
}

async function readInterests(brainDump: BrainDump, knownVenues: string[]): Promise<InterestsNote> {
  const note = parseInterestsNote(await brainDump.show(INTERESTS_NOTE), knownVenues);
  if (note.interests.length === 0) throw new PaperBotError(`${INTERESTS_NOTE} lists no Interests`);
  return note;
}

/** The OpenAlex source ids of the Venues the Interests watch; names the config doesn't map are the note's issues. */
function watchedVenues(note: InterestsNote, venues: Config["venues"]): string[] {
  return [...new Set(note.interests.flatMap((interest) => interest.venues.flatMap((venue) => venues[venue] ?? [])))];
}

/** Every source's Candidates in source order. A failed source is recorded and skipped; the Scan fails only when all do. */
async function fetchSources(deps: ScanDeps, venues: string[], sources: SourceResults, log: ScanLog): Promise<Candidate[]> {
  const { fetch, config } = deps;
  const at = deps.clock();
  const fetchers: Record<PaperSourceName, () => Promise<Candidate[]>> = {
    arxiv: () => fetchArxivCandidates(fetch, config.arxiv.categories),
    openalex: () => fetchOpenAlexCandidates(fetch, { key: config.openalex.key, venues }, at),
    eric: () => fetchEricCandidates(fetch, at),
    pmlr: () => fetchPmlrCandidates(fetch),
    jmlr: () => fetchJmlrCandidates(fetch),
  };
  const fetched = await Promise.all(
    (Object.entries(fetchers) as [PaperSourceName, () => Promise<Candidate[]>][]).map(async ([source, fetchCandidates]) => {
      try {
        const candidates = await fetchCandidates();
        sources[source] = { candidates: candidates.length };
        log(`${SOURCE_LABELS[source]}: ${candidates.length} Candidates`);
        return { source, candidates };
      } catch (error) {
        sources[source] = { error: messageOf(error) };
        log(`${SOURCE_LABELS[source]} failed: ${messageOf(error)}`);
        return { source, error: messageOf(error) };
      }
    }),
  );
  const failures = fetched.flatMap(({ source, error }) => (error === undefined ? [] : [`${SOURCE_LABELS[source]}: ${error}`]));
  if (failures.length === fetched.length) throw new PaperBotError(`every source failed (${failures.join("; ")})`);
  return fetched.flatMap(({ candidates }) => candidates ?? []);
}

/**
 * Merges Candidates that are one Paper, then drops those whose ids are in the store; a stored Paper takes up their new
 * ids. A Candidate matching two Papers is logged and merged into neither.
 */
function dropKnown(fetched: Candidate[], store: Store, log: ScanLog): Candidate[] {
  const { merged, conflicts } = mergeCandidates(fetched);
  const named = (candidate: Candidate) => `"${candidate.title}" (${primaryId(candidate)})`;
  for (const candidate of conflicts) log(`${named(candidate)} matches two other Candidates; its ids were not merged`);
  return merged.filter((candidate) => {
    const papers = store.matchKnown(candidate);
    if (papers.length > 1) log(`${named(candidate)} matches ${papers.length} stored Papers; its ids were not merged`);
    return papers.length === 0;
  });
}

type Ranked = PickInput;

/** Ranks in batches, saving each batch's scores as it finishes. A failed batch is logged; the Scan fails only when every batch fails. */
async function rankAll(rank: Ranker, candidates: Candidate[], note: InterestsNote, deps: ScanDeps, scanId: number, log: ScanLog): Promise<Ranked[]> {
  const ranked: Ranked[] = [];
  const size = deps.config.batch.size;
  let failures = 0;
  const batches = Math.ceil(candidates.length / size);
  for (let start = 0; start < candidates.length; start += size) {
    const batch = candidates.slice(start, start + size);
    const label = `ranking batch ${start / size + 1} of ${batches}`;
    const began = Date.now();
    try {
      const rankings = await rank(batch, note);
      const scored = batch.flatMap((candidate) => {
        const ranking: Ranking | undefined = rankings.get(primaryId(candidate));
        return ranking === undefined ? [] : [{ candidate, ranking }];
      });
      deps.store.saveRankings(scanId, scored, deps.clock());
      ranked.push(...scored);
      log(`${label}: ${scored.length} of ${batch.length} scored in ${Date.now() - began} ms`);
    } catch (error) {
      if (!(error instanceof PaperBotError)) throw error;
      failures++;
      log(`${label} failed after ${Date.now() - began} ms: ${error.message}`);
    }
  }
  if (failures === batches) throw new PaperBotError("every ranking batch failed");
  return ranked;
}

/**
 * The best Candidates at or above the Pick bar that match an Interest, then the best flagged Wildcards that match none
 * at or above the Wildcard bar, up to the cap. Each best first; ties keep fetch order. A Candidate with no abstract is
 * never a Pick.
 */
function choosePicks(ranked: Ranked[], bars: Config["bars"], wildcardCap: number): Ranked[] {
  const best = (filter: (ranking: Ranking) => boolean, count: number): Ranked[] =>
    ranked
      .filter(({ candidate, ranking }) => candidate.abstract !== "" && filter(ranking))
      .sort((a, b) => b.ranking.score - a.ranking.score)
      .slice(0, count);
  return [
    ...best((ranking) => ranking.score >= bars.pick && ranking.interests.length > 0, MAX_PICKS),
    ...best((ranking) => ranking.score >= bars.wildcard && ranking.interests.length === 0 && ranking.wildcard, wildcardCap),
  ];
}

function countBySource(ranked: Ranked[]): Partial<Record<Candidate["source"], number>> {
  const counts: Partial<Record<Candidate["source"], number>> = {};
  for (const { candidate } of ranked) counts[candidate.source] = (counts[candidate.source] ?? 0) + 1;
  return counts;
}
