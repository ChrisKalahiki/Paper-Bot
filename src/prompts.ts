import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { type IsoWeek, longDate } from "./clock.ts";
import type { Interest, InterestsNote, Wildcards } from "./interests.ts";
import type { WeekPick } from "./store.ts";

const interestList = (interests: Interest[]): string =>
  interests
    .map(({ name, description, venues, avoid }) =>
      [`## ${name}`, description, venues.length > 0 ? `Venues: ${venues.join(", ")}` : "", avoid.length > 0 ? `Avoid: ${avoid.join("; ")}` : ""]
        .filter((line) => line !== "")
        .join("\n"),
    )
    .join("\n\n");

const wildcardRule = ({ cap, hint }: Wildcards): string =>
  cap === 0
    ? "always false: Chris takes no Wildcards"
    : `true only when it matches no Interest but could still matter to a researcher in AI, education and HCI; Chris takes at most ${cap} a day, so flag only the strongest${hint ? `. His hint: ${hint}` : ""}`;

export function rankPrompt(batch: Candidate[], { interests, wildcards }: InterestsNote): string {
  const candidates = batch
    .map(
      (candidate) =>
        `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\nabstract: ${candidate.abstract || "none"}${candidate.signals ? `\nsignals: ${candidate.signals.join("; ")}` : ""}`,
    )
    .join("\n\n");
  return `You rank new research Papers for Chris against his Interests. Use only the titles, abstracts and signals below; do not browse or execute commands. A Candidate's signals say what else points at it, such as HF daily papers, a lab announcing it or a Venue accepting it: weigh them as context for your judgement, never as points added to a score.

His Interests, each with the Venues he watches and what he wants left out:

${interestList(interests)}

Reading priorities drawn from Chris's Learning to Vibe Code literature review, applied within the Interests above:
- For AI in higher education and AI in HCI, prioritize novice programmers and non-CS domain experts using AI to program. The central question is how people specify intent, understand, verify and repair generated code, and whether their confidence matches its correctness.
- Favor evidence connecting people's accounts to observed behavior, interaction logs or the quality and security of what they build and deploy. Distinguish self-reported confidence, successful task completion, and measured verification ability; distinguish immediate productivity from learning and transfer after AI support is removed.
- Work that informs a student vibe-coding interview study, instructor co-design, or a classroom deployment measuring learning and artifact quality is particularly valuable. Controlled experiments, longitudinal deployments, rigorous qualitative studies, systematic reviews, and useful theory or methods can all contribute. Value evidence that challenges the review's framing as well as evidence that supports it.
- Scaffolding, comparisons of tutoring approaches, learner models, self-regulation, trust calibration, and accessibility or equity in verification support are strong signals. Notebook and professional-developer studies matter especially when they offer transferable mechanisms or methods for novices or domain experts.
- Judge a Paper by the evidence in its title and abstract, with signals as context. A fashionable label, familiar author, famous Venue, vendor claim or large sample alone does not make it worth reading. Do not assume a preprint's claims are established or a claimed research gap is still open.
These priorities sharpen the education and HCI Interests; the other Interests remain independently eligible. Apply the Interests Note's Avoid lists and Wildcard rules below.

For every Candidate, return:
- id: its id, exactly as given;
- interests: the names of the Interests it matches, exactly as written above; none is fine;
- score: 0 to 10, how much Chris would want to read it today; 7 or above means it belongs in today's Briefing, and a Candidate an Interest's Avoid list describes scores below 7 for that Interest;
- why: one line of at most 30 words on what makes it matter to Chris, or not;
- wildcard: ${wildcardRule(wildcards)}.

Score every Candidate exactly once.

Candidates:

${candidates}
`;
}

/** `groups` names the Followed Groups whose member wrote it, when it is Picked for them rather than by ranking. */
export type PickInput = { candidate: Candidate; ranking: Ranking; groups?: string[] };

/** A Pick as the writer gets it: `fullText` is undefined when the Pick is written from its abstract. */
export type PickToWrite = PickInput & { fullText: string | undefined };

export type KeepInput = { paper: string; title: string; authors: string[]; url: string; abstract: string; why: string; summary: string };

export function keepPrompt(pick: KeepInput): string {
  return `Chris ticked Keep on this Pick. You draft the Dump that sends it to his Inbox, as JSON.

id: ${pick.paper}
title: ${pick.title}
authors: ${pick.authors.join(", ") || "unknown"}
link: ${pick.url}
why it was Picked: ${pick.why}
summary: ${pick.summary}
abstract: ${pick.abstract}

Return:
- header: one line naming the title, the authors, the arXiv id or Venue, and the link;
- learnings: 2 to 4 Learnings, one sentence each, never two, each a standalone statement Chris could file on its own: the method, the key finding, a limitation. End each with the link.

Use only what is given above. Write no Todos or Decisions.
`;
}

export function dailyPrompt(picks: PickToWrite[], interests: Interest[], at: Date): string {
  const listed = picks
    .map(
      ({ candidate, ranking, groups, fullText }) =>
        `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\n${groups?.length ? `followed group: ${groups.join(", ")}\n` : ""}interests: ${ranking.interests.join(", ") || (ranking.wildcard && !groups?.length ? "none, a Wildcard" : "none")}\nranking note: ${ranking.why}\nabstract: ${candidate.abstract || "none"}\nfull text: ${fullText ?? (candidate.abstract ? "none; write from the abstract" : "none; write from the title alone, saying only what it states")}`,
    )
    .join("\n\n");
  const anyFollowed = picks.some(({ groups }) => groups?.length);
  const followed = anyFollowed
    ? "\n\nA Pick with a followed group is here because Chris follows a group of researchers who wrote it, whatever its ranking; its why line says whether it bears on his Interests."
    : "";
  return `You write the prose of Chris's Daily Briefing for ${longDate(at)}. Code lays out the note; you return only the prose, as JSON.

His Interests: ${interests.map((interest) => interest.name).join("; ")}.

Today's Picks, ${anyFollowed ? "the ranked ones best first, then those from Followed Groups" : "best first"}:

${listed}${followed}

Return:
- take: one or two sentences, at most 60 words, on what today's Picks share or what stands out among them;
- picks: one entry per Pick, with its id exactly as given, a why line of about 20 words, never more than 30, on why it matters to Chris, and a summary of at most two sentences, never three, on what the Paper did and found, drawn from its full text where it has one.

Use only what is given above. Include no URLs, and name no Paper that is not listed.
`;
}

export function weeklyPrompt(week: IsoWeek, picks: WeekPick[], interests: string[]): string {
  const listed = picks
    .map(
      ({ paper, title, interests, wildcard, groups, why, summary }) =>
        `id: ${paper}\ntitle: ${title}\n${groups.length > 0 ? `followed group: ${groups.join(", ")}\n` : ""}interests: ${interests.join(", ") || (wildcard && groups.length === 0 ? "none, a Wildcard" : "none")}\nwhy it was Picked: ${why}\nsummary: ${summary}`,
    )
    .join("\n\n");
  return `You write the themes of Chris's Weekly Briefing for ${week.name}, ${longDate(week.monday)} to ${longDate(week.sunday)}. Code lays out the note; you return only the themes, as JSON.

His Interests: ${interests.join("; ")}.

This week's Picks, in the order they appeared:

${listed}${picks.some(({ groups }) => groups.length > 0) ? "\n\nA Pick with a followed group was Picked because Chris follows a group of researchers who wrote it, whatever its ranking." : ""}

Return:
- themes: two to four threads running through this week's Picks, or just one when the week is too thin for more, each a headline of one short sentence and a body of at most 50 words that names the Picks it draws on by title and the Interests they bear on.

Use only what is given above. Include no URLs, and name no Paper that is not listed.
`;
}
