import { type BrainDump, brainDumpCli } from "./brain-dump.ts";
import { dailyBriefingPath, renderDailyBriefing } from "./briefing.ts";
import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { type Clock, localDate } from "./clock.ts";
import type { Exec } from "./command.ts";
import type { Config } from "./config.ts";
import { messageOf, PaperBotError } from "./errors.ts";
import type { Fetch } from "./http.ts";
import { INTERESTS_NOTE, type Interest, parseInterestsNote } from "./interests.ts";
import { openScanLog, type ScanLog } from "./log.ts";
import type { PickInput } from "./prompts.ts";
import { codexRanker, type Ranker } from "./rank.ts";
import { fetchArxivCandidates } from "./sources/arxiv.ts";
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
    const interests = await readInterests(brainDump);
    log(`Interests: ${interests.map((interest) => interest.name).join("; ")}`);

    const fetched = await fetchSources(deps, sources, log);
    const candidates = fetched.filter((candidate) => !store.isKnown(candidate));
    log(`${candidates.length} new Candidates of ${fetched.length} fetched`);
    if (candidates.length === 0) return settle({ outcome: "skipped", reason: "no new Candidates" });

    const ranked = await rankAll(codexRanker(deps.exec, config.models.rank), candidates, interests, deps, scanId, log);
    const picks = choosePicks(ranked, config.bars.pick);
    if (picks.length === 0) return settle({ outcome: "skipped", reason: `no Candidate scored ${config.bars.pick} or above` });

    const prose = await claudeWriter(deps.exec, config.models.write)(picks, interests, startedAt);
    const rendered = picks.map(({ candidate, ranking }) => {
      const written = prose.picks.get(primaryId(candidate));
      if (written === undefined) throw new PaperBotError(`no prose for ${primaryId(candidate)}`);
      return { candidate, interests: ranking.interests, ...written };
    });
    const markdown = renderDailyBriefing({ at: startedAt, take: prose.take, picks: rendered, candidates: countBySource(ranked) });
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

async function readInterests(brainDump: BrainDump): Promise<Interest[]> {
  const interests = parseInterestsNote(await brainDump.show(INTERESTS_NOTE));
  if (interests.length === 0) throw new PaperBotError(`${INTERESTS_NOTE} lists no Interests`);
  return interests;
}

async function fetchSources(deps: ScanDeps, sources: SourceResults, log: ScanLog): Promise<Candidate[]> {
  try {
    const candidates = await fetchArxivCandidates(deps.fetch, deps.config.arxiv.categories);
    sources.arxiv = { candidates: candidates.length };
    log(`arXiv: ${candidates.length} Candidates`);
    return candidates;
  } catch (error) {
    sources.arxiv = { error: messageOf(error) };
    log(`arXiv failed: ${messageOf(error)}`);
    throw new PaperBotError(`every source failed (arXiv: ${messageOf(error)})`);
  }
}

type Ranked = PickInput;

/** Ranks in batches, saving each batch's scores as it finishes. A failed batch is logged; the Scan fails only when every batch fails. */
async function rankAll(rank: Ranker, candidates: Candidate[], interests: Interest[], deps: ScanDeps, scanId: number, log: ScanLog): Promise<Ranked[]> {
  const ranked: Ranked[] = [];
  const size = deps.config.batch.size;
  let failures = 0;
  const batches = Math.ceil(candidates.length / size);
  for (let start = 0; start < candidates.length; start += size) {
    const batch = candidates.slice(start, start + size);
    const label = `ranking batch ${start / size + 1} of ${batches}`;
    const began = Date.now();
    try {
      const rankings = await rank(batch, interests);
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

/** The best Candidates at or above the bar that match an Interest, best first; ties keep fetch order. */
function choosePicks(ranked: Ranked[], bar: number): Ranked[] {
  return ranked
    .filter(({ ranking }) => ranking.score >= bar && ranking.interests.length > 0)
    .sort((a, b) => b.ranking.score - a.ranking.score)
    .slice(0, MAX_PICKS);
}

function countBySource(ranked: Ranked[]): Partial<Record<Candidate["source"], number>> {
  const counts: Partial<Record<Candidate["source"], number>> = {};
  for (const { candidate } of ranked) counts[candidate.source] = (counts[candidate.source] ?? 0) + 1;
  return counts;
}
