import { type Candidate, primaryId, type SourceName } from "./candidate.ts";
import { localDate, longDate } from "./clock.ts";

const SOURCE_LABELS: Record<SourceName, string> = { arxiv: "arXiv" };

export function dailyBriefingPath(at: Date): string {
  return `Research/Briefings/Daily/${localDate(at)} Daily Briefing.md`;
}

export type RenderedPick = { candidate: Candidate; interests: string[]; wildcard: boolean; why: string; summary: string };

export type DailyBriefing = {
  at: Date;
  take: string;
  /** Best first. */
  picks: RenderedPick[];
  /** Candidates ranked this Scan, per source. */
  candidates: Partial<Record<SourceName, number>>;
  /** What paper-bot could not read in the Interests Note. */
  issues: string[];
};

/** The Obsidian block id that ties a Keep tick back to its Paper: `pick-` and the Paper's id, with each stretch of other characters as `-`. */
export function pickBlockId(candidate: Candidate): string {
  const id = primaryId(candidate).replace(/^[a-z]+:/, "");
  return `pick-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** Variant B, a ranked list: the take, then each Pick with its Interests, why, summary and Keep box, then the Candidate counts. */
export function renderDailyBriefing(briefing: DailyBriefing): string {
  const picks = briefing.picks.map(
    ({ candidate, interests, wildcard, why, summary }, i) =>
      `${i + 1}. **[${linkText(candidate.title)}](${candidate.url})** · *${wildcard ? "Wildcard" : interests.join(" · ")}*
   **Why it's here:** ${why}
   ${summary}
   - [ ] Keep ^${pickBlockId(candidate)}`,
  );
  const counts = Object.entries(briefing.candidates) as [SourceName, number][];
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const footer = [
    [`${total} candidates`, ...counts.map(([source, count]) => `${SOURCE_LABELS[source]} ${count}`)].join(" · "),
    ...(briefing.issues.length > 0 ? [`Interests Note issues: ${briefing.issues.join("; ")}`] : []),
  ].join("\n\n");
  return `---
tags: [briefing, briefing/daily]
date: ${localDate(briefing.at)}
picks: ${briefing.picks.length}
---

# Daily Briefing · ${longDate(briefing.at)}

> ${briefing.take}

${picks.join("\n")}

${footer}
`;
}

const linkText = (title: string): string => title.replace(/([[\]])/g, "\\$1");
