import { type Candidate, primaryId, SOURCE_LABELS, type SourceName } from "./candidate.ts";
import { localDate, longDate } from "./clock.ts";

export function dailyBriefingPath(at: Date): string {
  return `Research/Briefings/Daily/${localDate(at)} Daily Briefing.md`;
}

export type RenderedPick = { candidate: Candidate; interests: string[]; wildcard: boolean; why: string; summary: string; fromAbstract: boolean };

export type DailyBriefing = {
  at: Date;
  take: string;
  /** Best first. */
  picks: RenderedPick[];
  /** The best Candidates after the Picks, best first. */
  alsoConsidered: Candidate[];
  /** Candidates ranked this Scan, per source. */
  candidates: Partial<Record<SourceName, number>>;
  /** Why each failed source failed. */
  failedSources: Partial<Record<SourceName, string>>;
  /** Ranking batches that failed and Candidates over the batch cap, which wait for the next Scan. */
  rankingFailures: string[];
  /** What paper-bot could not read in the Interests Note. */
  issues: string[];
  /** Footer paragraphs on failed Keeps and ignored Keep lines. */
  keepIssues: string[];
};

/** The Obsidian block id that ties a Keep tick back to its Paper: `pick-` and the Paper's id, with each stretch of other characters as `-`. */
export function pickBlockId(candidate: Candidate): string {
  return blockIdOf(primaryId(candidate));
}

export function blockIdOf(paper: string): string {
  return `pick-${paper.replace(/^[a-z]+:/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Variant B, a ranked list: the take, then each Pick with its Interests, why, summary and Keep box, then a collapsed
 * Also considered list, then the footer.
 */
export function renderDailyBriefing(briefing: DailyBriefing): string {
  const picks = briefing.picks.map(
    ({ candidate, interests, wildcard, why, summary, fromAbstract }, i) =>
      `${i + 1}. **[${linkText(candidate.title)}](${candidate.url})** · *${wildcard ? "Wildcard" : interests.join(" · ")}*
   **Why it's here:** ${why}
   ${summary}${fromAbstract ? " *(from abstract)*" : ""}
   - [ ] Keep ^${pickBlockId(candidate)}`,
  );
  const alsoConsidered = briefing.alsoConsidered.map(
    (candidate) => `- [${linkText(candidate.title)}](${candidate.url})${candidate.abstract === "" ? " · *no abstract*" : ""}`,
  );
  const counts = Object.entries(briefing.candidates) as [SourceName, number][];
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const footer = [
    [`${total} candidates`, ...counts.map(([source, count]) => `${SOURCE_LABELS[source]} ${count}`)].join(" · "),
    ...(Object.entries(briefing.failedSources) as [SourceName, string][]).map(([source, error]) => `${SOURCE_LABELS[source]} failed: ${error}`),
    ...briefing.rankingFailures,
    ...(briefing.issues.length > 0 ? [`Interests Note issues: ${briefing.issues.join("; ")}`] : []),
    ...briefing.keepIssues,
  ].join("\n\n");
  return `---
tags: [briefing, briefing/daily]
date: ${localDate(briefing.at)}
picks: ${briefing.picks.length}
---

# Daily Briefing · ${longDate(briefing.at)}

> ${briefing.take}

${picks.join("\n")}
${alsoConsidered.length > 0 ? `\n<details><summary>Also considered (${alsoConsidered.length})</summary>\n\n${alsoConsidered.join("\n")}\n\n</details>\n` : ""}
${footer}
`;
}

const linkText = (title: string): string => title.replace(/([[\]])/g, "\\$1");
