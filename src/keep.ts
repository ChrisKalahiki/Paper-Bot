import type { BrainDump, KeptDump } from "./brain-dump.ts";
import { blockIdOf } from "./briefing.ts";
import { localDate } from "./clock.ts";
import { PaperBotError } from "./errors.ts";
import { WILDCARDS_HEADING } from "./interests.ts";
import type { ScanLog } from "./log.ts";
import { keepPrompt } from "./prompts.ts";
import { retryOnce } from "./retry.ts";
import type { ScanDeps } from "./scan.ts";
import type { KeepablePick } from "./store.ts";
import { claudeJson, oneLine } from "./write.ts";

const KEEP_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const KEEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["header", "learnings"],
  properties: {
    header: { type: "string" },
    learnings: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
  },
};

/** One ticked Keep line; `block` is its `^` block id, absent when the line has none. */
export type TickedKeep = { block?: string };

/** The ticked `- [x] Keep … ^pick-<id>` lines of a Briefing, Daily or Weekly. */
export function tickedKeeps(markdown: string): TickedKeep[] {
  return [...markdown.matchAll(/^[ \t]*- \[[xX]\] Keep\b(.*)$/gm)].map(([, rest = ""]) => {
    const block = rest.match(/\^([\w-]+)\s*$/)?.[1];
    return block === undefined ? {} : { block };
  });
}

/**
 * Sends each Paper newly ticked Keep in the last 30 days' Briefings to the Inbox as a Dump, once ever. A failed Keep is
 * retried each Scan until it can't be: once its Keep line is unticked or its Briefing is over 30 days old, it is dropped.
 * Returns the Briefing footer lines: Keeps that failed, to be retried next Scan, and Keep lines that were ignored.
 */
export async function keepTicked(deps: ScanDeps, brainDump: BrainDump, scanId: number, log: ScanLog): Promise<string[]> {
  const { store, clock } = deps;
  const picks = new Map(store.keepablePicks().map((pick) => [blockIdOf(pick.paper), pick]));
  const handled = new Set(store.keeps().flatMap(({ paper, dump }) => (dump === null ? [] : [paper])));
  const briefings = store.briefingsSince(localDate(new Date(clock().getTime() - KEEP_WINDOW_DAYS * DAY_MS)));
  const ticked = new Set<string>();
  const unread = new Set<string>();
  const issues: string[] = [];

  for (const briefing of briefings) {
    let text: string;
    try {
      text = await brainDump.show(briefing);
    } catch (error) {
      if (!(error instanceof PaperBotError)) throw error;
      unread.add(briefing);
      log(`cannot read ${briefing} for Keeps: ${error.message}`);
      continue;
    }
    for (const { block } of tickedKeeps(text)) {
      const pick = block === undefined ? undefined : picks.get(block);
      if (pick === undefined) {
        const where = noteLink(briefing);
        issues.push(block === undefined ? `Ignored a Keep line in ${where}: it has no ^pick- id.` : `Ignored the Keep line ^${block} in ${where}: it names no Pick.`);
        continue;
      }
      ticked.add(pick.paper);
      if (handled.has(pick.paper)) continue;
      handled.add(pick.paper);
      try {
        const dump = await brainDump.writeDump(keptDump(pick, briefing, await draftKeep(deps, pick, log)));
        store.recordKeep(scanId, pick.paper, briefing, { dump }, clock());
        log(`kept ${pick.paper} as ${dump}`);
      } catch (error) {
        if (!(error instanceof PaperBotError)) throw error;
        store.recordKeep(scanId, pick.paper, briefing, { error: error.message }, clock());
        issues.push(`Keep of "${pick.title}" failed, to be retried next Scan: ${error.message}`);
        log(`Keep of ${pick.paper} failed: ${error.message}`);
      }
    }
  }

  for (const { paper, briefing, error } of store.keeps()) {
    if (error === null || ticked.has(paper) || unread.has(briefing)) continue;
    store.dropKeep(paper);
    const why = briefings.includes(briefing) ? "its Keep line is no longer ticked" : `${briefing} is more than ${KEEP_WINDOW_DAYS} days old`;
    log(`dropped the failed Keep of ${paper}: ${why}`);
  }
  return issues;
}

export type KeepDraft = { header: string; learnings: string[] };

async function draftKeep(deps: ScanDeps, pick: KeepablePick, log: ScanLog): Promise<KeepDraft> {
  const output = await retryOnce(`Drafting the Keep of ${pick.paper}`, () => claudeJson(deps.exec, deps.config.models.write, KEEP_SCHEMA, keepPrompt(pick)), deps.sleep, log);
  if (typeof output !== "object" || output === null || !("header" in output) || typeof output.header !== "string" || !("learnings" in output)) {
    throw new PaperBotError("claude -p returned a Keep in the wrong shape");
  }
  const { learnings } = output;
  if (!Array.isArray(learnings) || learnings.length < 2 || learnings.length > 4 || !learnings.every((learning) => typeof learning === "string")) {
    throw new PaperBotError("claude -p returned a Keep without 2 to 4 Learnings");
  }
  return { header: output.header, learnings };
}

/** The Dump `write-dump` gets for a Kept Pick drafted as `draft`, from the Briefing it was ticked in. */
export function keptDump(pick: KeepablePick, briefing: string, draft: KeepDraft): KeptDump {
  return { briefing, paper: pick.paper, project: projectOf(pick), slug: slugOf(pick.title), body: renderDumpBody(draft, pick.url) };
}

/** A Dump body holds only Items, so the header leads the Learnings; every line carries the Paper's link. */
function renderDumpBody({ header, learnings }: KeepDraft, url: string): string {
  const items = [header, ...learnings].map((line) => {
    const text = oneLine(line);
    return `- [ ] ${text.includes(url) ? text : `${text} ${url}`}`;
  });
  return `## Learnings\n${items.join("\n")}\n`;
}

/** The Pick's first Interest; a Wildcard, which matches none, goes under the Interests Note's Wildcards section. */
const projectOf = (pick: KeepablePick): string => pick.interests[0] ?? WILDCARDS_HEADING;

/** The title's first six words, without the characters a Dump slug refuses. */
function slugOf(title: string): string {
  const words = title.replace(/[*"\\/<>:|?#^[\]]/g, " ").split(/\s+/).filter((word) => word !== "").slice(0, 6);
  return (words.length < 2 ? [...words, "Paper"] : words).join(" ");
}

const noteLink = (path: string): string => `[[${path.replace(/^.*\//, "").replace(/\.md$/, "")}]]`;
