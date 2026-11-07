import { type BrainDump, brainDumpCli } from "./brain-dump.ts";
import { dailyBriefingPath, renderDailyBriefing } from "./briefing.ts";
import { type CatchUp, catchUpSince, coversLine } from "./catch-up.ts";
import { type Candidate, mergeCandidates, type PaperSourceName, primaryId, type Ranking, SOURCE_LABELS, type SourceName } from "./candidate.ts";
import { type Clock, DAY_MS, localDate } from "./clock.ts";
import { type Exec, loggingExec } from "./command.ts";
import type { Config } from "./config.ts";
import { PaperBotError } from "./errors.ts";
import { readFullTexts } from "./full-text.ts";
import type { Fetch } from "./http.ts";
import { followedAuthorIds, groupsOf, INTERESTS_NOTE, type InterestsNote, parseInterestsNote } from "./interests.ts";
import { KEEP_WINDOW_DAYS, keepTicked } from "./keep.ts";
import { deleteScanLogsBefore, openScanLog, type ScanLog } from "./log.ts";
import { fetchPointers, withSignals } from "./pointers.ts";
import type { PickInput } from "./prompts.ts";
import { codexRanker, type Ranker } from "./rank.ts";
import { retryingFetch, retryOnce, type Sleep } from "./retry.ts";
import { recordFailedSource, type ScanContext } from "./scan-context.ts";
import { fetchArxivCandidates, fetchArxivSubmitted } from "./sources/arxiv.ts";
import { fetchEricCandidates } from "./sources/eric.ts";
import { fetchJmlrCandidates } from "./sources/jmlr.ts";
import { fetchOpenAlexCandidates, WINDOW_DAYS as OPENALEX_WINDOW_DAYS } from "./sources/openalex.ts";
import { fetchPmlrCandidates } from "./sources/pmlr.ts";
import type { Outcome, PickRecord, ScanKind, SourceResults, Store } from "./store.ts";
import { claudeWriter } from "./write.ts";

const MAX_PICKS = 5;
const ALSO_CONSIDERED = 6;
const ABSTRACT_DAYS = KEEP_WINDOW_DAYS;
const LOG_DAYS = 90;

/** Everything a Scan touches outside itself, so tests can drive the real pipeline against fakes. */
export type ScanDeps = { config: Config; store: Store; fetch: Fetch; exec: Exec; clock: Clock; logDir: string; sleep: Sleep };

/** How a Scan settled; a Scan whose Briefing is already written settles nothing, leaving its scores to the next Scan. */
export type ScanResult = { outcome: Outcome; reason?: string; briefing?: string } | { outcome: "already written"; briefing: string };

export const SCAN_NAMES: Record<ScanKind, string> = { daily: "Daily Scan", weekly: "Weekly Scan" };

/** How a Scan's pipeline settles it; `picks` are those of the Briefing it wrote. */
type Settling = ScanResult & { picks?: PickRecord[] };

/** What a pipeline returns when `write-briefing` finds its Briefing at `path` already in the Vault. */
export const alreadyWritten = (path: string): ScanResult => ({ outcome: "already written", briefing: path });

/**
 * Opens the log and the record of a Scan dated `date`, hands them to `pipeline` with an Exec that logs each command, and
 * settles the record with what the pipeline returns, or as failed on a PaperBotError. Any other error is logged and thrown.
 * When a Scan of `kind` dated `date` already wrote its Briefing, it starts no Scan; when the pipeline finds its Briefing
 * already in the Vault, it settles nothing. `about` follows the Scan's id in its first log line.
 */
export async function recordedScan(
  scanDeps: ScanDeps,
  kind: ScanKind,
  date: string,
  pipeline: (deps: ScanDeps, scan: ScanContext) => Promise<Settling>,
  about = "",
): Promise<ScanResult> {
  const { store, clock } = scanDeps;
  const name = SCAN_NAMES[kind];
  const log = openScanLog(scanDeps.logDir, kind, clock);
  const [written] = store.writtenBriefings({ kind, from: date, to: date });
  if (written !== undefined) {
    log(`${name} not started: ${written} is already written`);
    return { outcome: "already written", briefing: written };
  }
  const deps = { ...scanDeps, exec: loggingExec(scanDeps.exec, log) };
  const scan: ScanContext = { scanId: store.startScan(kind, date, clock()), log, sources: {}, rankingFailures: [] };
  log(`${name} ${scan.scanId}${about === "" ? "" : ` ${about}`} started`);

  const settle = ({ picks = [], ...result }: Settling): ScanResult => {
    if (result.outcome === "already written") {
      log(`${name} left unsettled: ${result.briefing} is already written`);
      return result;
    }
    store.settleScan(scan.scanId, { ...result, sources: scan.sources, at: clock() }, picks);
    log(`${name} ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
    return result;
  };

  try {
    return settle(await pipeline(deps, scan));
  } catch (error) {
    if (!(error instanceof PaperBotError)) {
      log(`${name} crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      throw error;
    }
    return settle({ outcome: "failed", reason: error.message });
  }
}

/**
 * Reads the Interests, fetches and ranks today's Candidates, and writes a Daily Briefing of the Picks.
 * The Scan is skipped when nothing clears the bar, and failed when it cannot settle its Briefing.
 */
export function dailyScan(scanDeps: ScanDeps): Promise<ScanResult> {
  return recordedScan(scanDeps, "daily", localDate(scanDeps.clock()), daily);
}

async function daily(deps: ScanDeps, scan: ScanContext): Promise<Settling> {
  const { config, store, clock } = deps;
  const { log } = scan;
  const startedAt = clock();
  const catchUp = catchUpSince(store.arxivCoveredThrough(), localDate(startedAt));
  if (catchUp !== undefined) log(`Catching up on ${catchUp.days.map(localDate).join(", ")}`);
  prune(deps, startedAt, log);

  const brainDump = brainDumpCli(deps.exec, config.brainDump);
  const keepIssues = await keepTicked(deps, brainDump, scan);
  const note = await readInterests(brainDump, Object.keys(config.venues));
  log(`Interests: ${note.interests.map((interest) => interest.name).join("; ")}`);
  for (const issue of note.issues) log(`Interests Note issue: ${issue}`);

  const [fetched, pointers] = await Promise.all([
    fetchSources(deps, { venues: watchedVenues(note, config.venues), authorIds: followedAuthorIds(note.followedGroups) }, catchUp, scan),
    fetchPointers({ fetch: retryingFetch(deps.fetch, deps.sleep, log), store, at: startedAt, days: catchUp?.days ?? [startedAt] }, scan),
  ]);
  const pending = store.pending();
  const { fresh, known } = dropKnown([...pending, ...fetched, ...pointers.candidates], store, log);
  const candidates = withSignals(fresh, pointers.signals);
  log(`${candidates.length} new Candidates of ${fetched.length + pointers.candidates.length} fetched and ${pending.length} pending`);

  if (candidates.length > 0) await rankAll(codexRanker(deps.exec, config.models.rank), candidates, note, deps, scan);
  const ranked = store.unsettledRankings();
  const groupPicks = followedGroupPicks(ranked, store.unpickedRankings(known, new Date(startedAt.getTime() - OPENALEX_WINDOW_DAYS * DAY_MS)), note);
  if (ranked.length === 0 && groupPicks.length === 0) return { outcome: "skipped", reason: "no new Candidates" };
  const picks = [...choosePicks(ranked.filter((entry) => !groupPicks.some((pick) => samePaper(pick, entry))), config.bars, note.wildcards.cap), ...groupPicks];
  if (picks.length === 0) return { outcome: "skipped", reason: `no Candidate scored ${config.bars.pick} or above` };

  const toWrite = await readFullTexts(deps.fetch, picks, log);
  const write = claudeWriter(deps.exec, config.models.write);
  const prose = await retryOnce("Writing the Daily Briefing", () => write(toWrite, note.interests, startedAt), deps.sleep, log);
  const rendered = toWrite.map(({ candidate, ranking, groups, fullText }) => {
    const written = prose.picks.get(primaryId(candidate));
    if (written === undefined) throw new PaperBotError(`no prose for ${primaryId(candidate)}`);
    return { candidate, interests: ranking.interests, wildcard: ranking.wildcard, groups: groups ?? [], ...written, fromAbstract: fullText === undefined };
  });
  const markdown = renderDailyBriefing({
    at: startedAt,
    take: catchUp === undefined ? prose.take : `${coversLine(catchUp)} ${prose.take}`,
    picks: rendered,
    alsoConsidered: alsoConsidered(ranked, picks),
    candidates: countBySource(ranked),
    failedSources: failedSources(scan.sources),
    rankingFailures: scan.rankingFailures,
    issues: note.issues,
    keepIssues,
  });
  const path = dailyBriefingPath(startedAt);
  const briefing = await brainDump.writeBriefing(path, markdown);
  if (briefing === null) return alreadyWritten(path);
  log(`wrote ${briefing}`);
  return {
    outcome: "written",
    briefing,
    ...degraded(scan),
    picks: rendered.map((pick, i) => ({
      candidate: pick.candidate,
      rank: i + 1,
      why: pick.why,
      summary: pick.summary,
      ...(pick.groups.length > 0 && { groups: pick.groups }),
    })),
  };
}

/** Deletes the abstracts of Papers never Picked after 30 days, the Keep lookback, and Scan logs after 90. */
function prune({ store, logDir }: ScanDeps, at: Date, log: ScanLog): void {
  const daysBefore = (days: number) => new Date(at.getTime() - days * DAY_MS);
  const pruned = store.pruneAbstracts(daysBefore(ABSTRACT_DAYS));
  if (pruned > 0) log(`Deleted the abstracts of Papers never Picked and first seen before ${localDate(daysBefore(ABSTRACT_DAYS))}: ${pruned}`);
  const logs = deleteScanLogsBefore(logDir, localDate(daysBefore(LOG_DAYS)));
  if (logs > 0) log(`Deleted Scan logs from before ${localDate(daysBefore(LOG_DAYS))}: ${logs}`);
}

/** The Interests Note, which must list an Interest; Venue names not in `knownVenues` are among its issues. */
export async function readInterests(brainDump: BrainDump, knownVenues: string[]): Promise<InterestsNote> {
  const note = parseInterestsNote(await brainDump.show(INTERESTS_NOTE), knownVenues);
  if (note.interests.length === 0) throw new PaperBotError(`${INTERESTS_NOTE} lists no Interests`);
  return note;
}

/** The OpenAlex source ids of the Venues the Interests watch. */
function watchedVenues(note: InterestsNote, venues: Config["venues"]): string[] {
  return [...new Set(note.interests.flatMap((interest) => interest.venues.flatMap((venue) => venues[venue] ?? [])))];
}

/**
 * Every source's Candidates in source order; arXiv gives its latest announcement, or on a catch-up every Paper
 * submitted since the first missed day. A failed source is recorded and skipped; the Scan fails only when all do.
 */
async function fetchSources(
  deps: ScanDeps,
  { venues, authorIds }: { venues: string[]; authorIds: string[] },
  catchUp: CatchUp | undefined,
  scan: ScanContext,
): Promise<Candidate[]> {
  const { config } = deps;
  const fetch = retryingFetch(deps.fetch, deps.sleep, scan.log);
  const at = deps.clock();
  const fetchers: Record<PaperSourceName, () => Promise<Candidate[]>> = {
    arxiv: () =>
      catchUp === undefined
        ? fetchArxivCandidates(fetch, config.arxiv.categories)
        : fetchArxivSubmitted(fetch, config.arxiv.categories, { from: catchUp.submittedFrom, to: at }, deps.sleep),
    openalex: () => {
      const names = Object.fromEntries(Object.entries(config.venues).map(([name, id]) => [id, name]));
      return fetchOpenAlexCandidates(fetch, { key: config.openalex.key, venues, names, authorIds }, at);
    },
    eric: () => fetchEricCandidates(fetch, at),
    pmlr: () => fetchPmlrCandidates(fetch),
    jmlr: () => fetchJmlrCandidates(fetch),
  };
  const fetched = await Promise.all(
    (Object.entries(fetchers) as [PaperSourceName, () => Promise<Candidate[]>][]).map(async ([source, fetchCandidates]) => {
      try {
        const candidates = await fetchCandidates();
        scan.sources[source] = { candidates: candidates.length };
        scan.log(`${SOURCE_LABELS[source]}: ${candidates.length} Candidates`);
        return { source, candidates };
      } catch (error) {
        return { source, error: recordFailedSource(scan, source, error) };
      }
    }),
  );
  const failures = fetched.flatMap(({ source, error }) => (error === undefined ? [] : [`${SOURCE_LABELS[source]}: ${error}`]));
  if (failures.length === fetched.length) throw new PaperBotError(`every source failed (${failures.join("; ")})`);
  return fetched.flatMap(({ candidates }) => candidates ?? []);
}

/**
 * Merges Candidates that are one Paper, then drops those whose ids are in the store; a stored Paper takes up their new
 * ids and author ids. `fresh` are the Candidates left, `known` the stored Papers dropped ones matched. A Candidate
 * matching two Papers is logged and merged into neither.
 */
function dropKnown(fetched: Candidate[], store: Store, log: ScanLog): { fresh: Candidate[]; known: number[] } {
  const { merged, conflicts } = mergeCandidates(fetched);
  const named = (candidate: Candidate) => `"${candidate.title}" (${primaryId(candidate)})`;
  for (const candidate of conflicts) log(`${named(candidate)} matches two other Candidates; its ids were not merged`);
  const known: number[] = [];
  const fresh = merged.filter((candidate) => {
    const papers = store.matchKnown(candidate);
    if (papers.length > 1) log(`${named(candidate)} matches ${papers.length} stored Papers; its ids were not merged`);
    if (papers.length === 1) known.push(...papers);
    return papers.length === 0;
  });
  return { fresh, known };
}

/**
 * The Papers a Followed Group's member wrote, best first, whatever their score: among this Scan's rankings, and among
 * the stored Papers fetched again that were ranked but never Picked, which become Late Picks.
 */
function followedGroupPicks(ranked: PickInput[], unpicked: PickInput[], note: InterestsNote): PickInput[] {
  const late = unpicked.filter((entry) => !ranked.some((other) => samePaper(other, entry)));
  return [...ranked, ...late]
    .map((entry) => ({ ...entry, groups: groupsOf(entry.candidate, note.followedGroups) }))
    .filter(({ groups }) => groups.length > 0)
    .sort((a, b) => b.ranking.score - a.ranking.score);
}

const samePaper = (a: PickInput, b: PickInput): boolean => primaryId(a.candidate) === primaryId(b.candidate);

/**
 * Ranks in batches, at most `batch.cap` of them, saving each batch's scores as it finishes. Candidates over the cap and
 * those in a failed batch go to pending, for the next Scan to rank first. The Scan fails only when every batch fails.
 */
async function rankAll(rank: Ranker, candidates: Candidate[], note: InterestsNote, deps: ScanDeps, scan: ScanContext): Promise<void> {
  const { store, clock } = deps;
  const { log, rankingFailures } = scan;
  const { size, cap } = deps.config.batch;
  const batches: Candidate[][] = [];
  for (let start = 0; start < Math.min(candidates.length, size * cap); start += size) batches.push(candidates.slice(start, start + size));
  const overflow = candidates.slice(size * cap);
  if (overflow.length > 0) {
    store.addPending(overflow, clock());
    const over = `${overflow.length} Candidates over the cap of ${cap} ranking batches wait for the next Scan`;
    rankingFailures.push(over);
    log(over);
  }
  let failed = 0;
  for (const [i, batch] of batches.entries()) {
    const label = `Ranking batch ${i + 1} of ${batches.length}`;
    const began = clock().getTime();
    const elapsed = () => clock().getTime() - began;
    try {
      const rankings = await retryOnce(label, () => rank(batch, note), deps.sleep, log);
      const scored = batch.flatMap((candidate) => {
        const ranking: Ranking | undefined = rankings.get(primaryId(candidate));
        return ranking === undefined ? [] : [{ candidate, ranking }];
      });
      store.saveRankings(scan.scanId, scored, clock());
      log(`${label}: ${scored.length} of ${batch.length} scored in ${elapsed()} ms`);
    } catch (error) {
      if (!(error instanceof PaperBotError)) throw error;
      failed++;
      store.addPending(batch, clock());
      rankingFailures.push(`${label} failed, its Candidates wait for the next Scan: ${error.message}`);
      log(`${label} failed after ${elapsed()} ms, its Candidates wait for the next Scan: ${error.message}`);
    }
  }
  if (failed === batches.length) throw new PaperBotError("every ranking batch failed");
}

/**
 * The best Candidates at or above the Pick bar that match an Interest, then the best flagged Wildcards that match none
 * at or above the Wildcard bar, up to the cap. Each best first; ties keep fetch order. A Candidate with no abstract is
 * never a Pick.
 */
function choosePicks(ranked: PickInput[], bars: Config["bars"], wildcardCap: number): PickInput[] {
  const best = (filter: (ranking: Ranking) => boolean, count: number): PickInput[] =>
    ranked
      .filter(({ candidate, ranking }) => candidate.abstract !== "" && filter(ranking))
      .sort((a, b) => b.ranking.score - a.ranking.score)
      .slice(0, count);
  return [
    ...best((ranking) => ranking.score >= bars.pick && ranking.interests.length > 0, MAX_PICKS),
    ...best((ranking) => ranking.score >= bars.wildcard && ranking.interests.length === 0 && ranking.wildcard, wildcardCap),
  ];
}

/** The best ranked Candidates that are not Picks, Candidates with no abstract among them. Each best first; ties keep fetch order. */
function alsoConsidered(ranked: PickInput[], picks: PickInput[]): Candidate[] {
  return ranked
    .filter((entry) => !picks.some((pick) => samePaper(pick, entry)))
    .sort((a, b) => b.ranking.score - a.ranking.score)
    .slice(0, ALSO_CONSIDERED)
    .map(({ candidate }) => candidate);
}

/** A written Scan's reason when it lost sources or ranking batches: what failed. */
function degraded({ sources, rankingFailures }: ScanContext): { reason?: string } {
  const failures = [
    ...(Object.entries(failedSources(sources)) as [SourceName, string][]).map(([source, error]) => `${SOURCE_LABELS[source]} failed: ${error}`),
    ...rankingFailures,
  ];
  return failures.length === 0 ? {} : { reason: `degraded: ${failures.join("; ")}` };
}

function failedSources(sources: SourceResults): Partial<Record<SourceName, string>> {
  const failed: Partial<Record<SourceName, string>> = {};
  for (const source of Object.keys(SOURCE_LABELS) as SourceName[]) {
    const result = sources[source];
    if (result !== undefined && "error" in result) failed[source] = result.error;
  }
  return failed;
}

function countBySource(ranked: PickInput[]): Partial<Record<Candidate["source"], number>> {
  const counts: Partial<Record<Candidate["source"], number>> = {};
  for (const { candidate } of ranked) counts[candidate.source] = (counts[candidate.source] ?? 0) + 1;
  return counts;
}
