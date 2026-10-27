import { brainDumpCli } from "./brain-dump.ts";
import { renderWeeklyBriefing, type Theme, weeklyBriefingPath } from "./briefing.ts";
import { type IsoWeek, localDate } from "./clock.ts";
import { loggingExec } from "./command.ts";
import { PaperBotError } from "./errors.ts";
import { openScanLog } from "./log.ts";
import { weeklyPrompt } from "./prompts.ts";
import { retryOnce } from "./retry.ts";
import { readInterests, type ScanDeps, type ScanResult } from "./scan.ts";
import { claudeJson, oneLine } from "./write.ts";

const THEMES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["themes"],
  properties: {
    themes: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "body"],
        properties: { headline: { type: "string" }, body: { type: "string" } },
      },
    },
  },
};

/**
 * Writes the Weekly Briefing of `week` from the Picks of its Daily Briefings; it fetches and ranks nothing.
 * The Scan is skipped when the week has no Picks, and failed when it cannot settle its Briefing.
 */
export async function weeklyScan(scanDeps: ScanDeps, week: IsoWeek): Promise<ScanResult> {
  const { config, store, clock } = scanDeps;
  const log = openScanLog(scanDeps.logDir, "weekly", clock);
  const deps = { ...scanDeps, exec: loggingExec(scanDeps.exec, log) };
  const from = localDate(week.monday);
  const to = localDate(week.sunday);
  const scanId = store.startScan("weekly", from, clock());
  log(`Weekly Scan ${scanId} of ${week.name} started`);

  const settle = (result: ScanResult): ScanResult => {
    store.settleScan(scanId, { ...result, sources: {}, at: clock() }, []);
    log(`Weekly Scan ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
    return result;
  };

  try {
    const picks = store.weekPicks(from, to);
    if (picks.length === 0) return settle({ outcome: "skipped", reason: `no Picks in ${week.name}` });

    const brainDump = brainDumpCli(deps.exec, config.brainDump);
    const note = await readInterests(brainDump, Object.keys(config.venues));
    const interests = [...new Set([...note.interests.map((interest) => interest.name), ...picks.flatMap((pick) => pick.interests)])];
    const themes = await retryOnce(
      "Writing the Weekly Briefing",
      async () => readThemes(await claudeJson(deps.exec, config.models.write, THEMES_SCHEMA, weeklyPrompt(week, picks, interests))),
      deps.sleep,
      log,
    );
    const dailies = store
      .scans()
      .flatMap(({ kind, date, outcome, briefing }) => (kind === "daily" && outcome === "written" && briefing !== null && date >= from && date <= to ? [briefing] : []));
    const briefing = await brainDump.writeBriefing(weeklyBriefingPath(week), renderWeeklyBriefing({ week, themes, interests, picks, dailies }));
    log(`wrote ${briefing}`);
    return settle({ outcome: "written", briefing });
  } catch (error) {
    if (!(error instanceof PaperBotError)) {
      log(`Weekly Scan crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      throw error;
    }
    return settle({ outcome: "failed", reason: error.message });
  }
}

function readThemes(output: unknown): Theme[] {
  const themes = typeof output === "object" && output !== null && "themes" in output && Array.isArray(output.themes) ? (output.themes as unknown[]) : [];
  const read = themes.flatMap((theme) => {
    if (typeof theme !== "object" || theme === null) return [];
    const { headline, body } = theme as Record<string, unknown>;
    return typeof headline === "string" && typeof body === "string" ? [{ headline: oneLine(headline), body: oneLine(body) }] : [];
  });
  if (read.length === 0) throw new PaperBotError("claude -p returned themes in the wrong shape");
  return read;
}
