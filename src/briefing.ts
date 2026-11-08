import { type Candidate, primaryId, SOURCE_LABELS, type SourceName } from "./candidate.ts";
import { dayAndMonth, type IsoWeek, localDate, longDate } from "./clock.ts";
import { WILDCARDS_HEADING } from "./interests.ts";
import type { WeekPick } from "./store.ts";

const TOP_PICKS = 5;

export function dailyBriefingPath(at: Date): string {
  return `Research/Briefings/Daily/${localDate(at)} Daily Briefing.md`;
}

/** `groups` names the Followed Groups a Pick was chosen for, empty for a ranked Pick. */
export type RenderedPick = { candidate: Candidate; interests: string[]; wildcard: boolean; groups: string[]; why: string; summary: string; fromAbstract: boolean };

export type DailyBriefing = {
  at: Date;
  take: string;
  /** The ranked Picks best first, then the Followed Groups' Picks best first. */
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
 * Variant B, a ranked list: the take, then each ranked Pick with its Interests, why, summary and Keep box, then the
 * Followed Groups' Picks tagged with their groups, then a collapsed Also considered list, then the footer.
 */
export function renderDailyBriefing(briefing: DailyBriefing): string {
  const ranked = briefing.picks.filter((pick) => pick.groups.length === 0);
  const followed = briefing.picks.filter((pick) => pick.groups.length > 0);
  const tags = ({ interests, wildcard, groups }: RenderedPick): string =>
    [...groups.map((group) => `**${group}**`), ...(wildcard && groups.length === 0 ? ["*Wildcard*"] : interests.length > 0 ? [`*${interests.join(" · ")}*`] : [])].join(" · ");
  const list = (picks: RenderedPick[]) =>
    picks.map(
      (pick, i) =>
        `${i + 1}. **[${linkText(pick.candidate.title)}](${pick.candidate.url})** · ${tags(pick)}
   **Why it's here:** ${pick.why}
   ${pick.summary}${pick.fromAbstract ? ` *(from ${pick.candidate.abstract === "" ? "title" : "abstract"})*` : ""}
   - [ ] Keep ^${pickBlockId(pick.candidate)}`,
    );
  const picks = [...list(ranked), ...(followed.length > 0 ? [`\n## From Followed Groups\n\n${list(followed).join("\n")}`] : [])];
  const groupCounts = new Map<string, number>();
  for (const group of followed.flatMap((pick) => pick.groups)) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  const alsoConsidered = briefing.alsoConsidered.map(
    (candidate) => `- [${linkText(candidate.title)}](${candidate.url})${candidate.abstract === "" ? " · *no abstract*" : ""}`,
  );
  const counts = Object.entries(briefing.candidates) as [SourceName, number][];
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const footer = [
    [`${total} candidates`, ...counts.map(([source, count]) => `${SOURCE_LABELS[source]} ${count}`)].join(" · "),
    ...(groupCounts.size > 0 ? [`Followed Groups: ${[...groupCounts].map(([group, count]) => `${group} ${count}`).join(" · ")}`] : []),
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

export function weeklyBriefingPath(week: IsoWeek): string {
  return `Research/Briefings/Weekly/${week.name} Weekly Briefing.md`;
}

export type Theme = { headline: string; body: string };

export type WeeklyBriefing = {
  week: IsoWeek;
  themes: Theme[];
  /** The Interests Note's Interests, then any other Interest a Pick names. */
  interests: string[];
  /** The week's Picks, by date and then rank. */
  picks: WeekPick[];
  /** The week's Daily Briefings, oldest first. */
  dailies: string[];
};

/**
 * Variant W1, themes first, with W2's per-Interest table: the themes and quiet Interests, Picks and Keeps per Interest,
 * the best ranked Picks not yet Kept with Keep boxes, the Followed Groups' Picks not yet Kept with Keep boxes, the Picks
 * already Kept, then links to the week's Daily Briefings.
 */
export function renderWeeklyBriefing({ week, themes, interests, picks, dailies }: WeeklyBriefing): string {
  const ofInterest = (name: string) => picks.filter((pick) => pick.interests.includes(name));
  const wildcards = picks.filter((pick) => pick.wildcard && pick.interests.length === 0 && pick.groups.length === 0);
  const quiet = interests.filter((name) => ofInterest(name).length === 0);
  const rows: [string, WeekPick[]][] = interests.map((name) => [name, ofInterest(name)]);
  if (wildcards.length > 0) rows.push([WILDCARDS_HEADING, wildcards]);
  const keepLine = (pick: WeekPick) =>
    `- [ ] Keep [${linkText(pick.title)}](${pick.url}) · ${pick.groups.map((group) => `**${group}** · `).join("")}from ${noteLink(pick.briefing)} ^${blockIdOf(pick.paper)}`;
  const top = picks
    .filter((pick) => !pick.kept && pick.groups.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_PICKS)
    .map(keepLine);
  const followed = picks.filter((pick) => !pick.kept && pick.groups.length > 0).map(keepLine);
  const kept = picks.filter((pick) => pick.kept).map((pick) => `- [${linkText(pick.title)}](${pick.url}) → in the Inbox`);
  const paragraphs = [
    ...themes.map(({ headline, body }) => `**${headline}** ${body}`),
    ...(quiet.length > 0 ? [`**Quiet:** ${quiet.join(", ")} had no Pick this week.`] : []),
  ];
  const sections = [
    `## This week in your Interests

${paragraphs.join("\n\n")}

| Interest | Picks | Kept |
| --- | --- | --- |
${rows.map(([name, ofRow]) => `| ${name} | ${ofRow.length} | ${ofRow.filter((pick) => pick.kept).length} |`).join("\n")}`,
    ...(top.length > 0 ? [`## Top Picks\n\n${top.join("\n")}`] : []),
    ...(followed.length > 0 ? [`## From Followed Groups\n\n${followed.join("\n")}`] : []),
    ...(kept.length > 0 ? [`## Already kept this week\n\n${kept.join("\n")}`] : []),
    `## Daily Briefings\n\n${dailies.map(noteLink).join(" · ")}`,
  ];
  return `---
tags: [briefing, briefing/weekly]
week: ${week.name}
dailies: ${dailies.length}
picks: ${picks.length}
---

# Weekly Briefing · ${week.name} (${dayAndMonth(week.monday)} – ${dayAndMonth(week.sunday)})

${sections.join("\n\n")}
`;
}

const noteLink = (path: string): string => `[[${path.replace(/^.*\//, "").replace(/\.md$/, "")}]]`;

const linkText =(title: string): string => title.replace(/([[\]])/g, "\\$1");
