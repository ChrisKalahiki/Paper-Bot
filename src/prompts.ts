import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { longDate } from "./clock.ts";
import type { Interest, InterestsNote, Wildcards } from "./interests.ts";

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
  const candidates = batch.map((candidate) => `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\nabstract: ${candidate.abstract || "none"}`).join("\n\n");
  return `You rank new research Papers for Chris against his Interests. Use only the titles and abstracts below; do not browse or execute commands.

His Interests, each with the Venues he watches and what he wants left out:

${interestList(interests)}

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

export type PickInput = { candidate: Candidate; ranking: Ranking };

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
- learnings: 2 to 4 Learnings, one line each, each a standalone statement Chris could file on its own: the method, the key finding, a limitation. End each with the link.

Use only what is given above. Write no Todos or Decisions.
`;
}

export function dailyPrompt(picks: PickToWrite[], interests: Interest[], at: Date): string {
  const listed = picks
    .map(
      ({ candidate, ranking, fullText }) =>
        `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\ninterests: ${ranking.interests.join(", ") || (ranking.wildcard ? "none, a Wildcard" : "none")}\nranking note: ${ranking.why}\nabstract: ${candidate.abstract}\nfull text: ${fullText ?? "none; write from the abstract"}`,
    )
    .join("\n\n");
  return `You write the prose of Chris's Daily Briefing for ${longDate(at)}. Code lays out the note; you return only the prose, as JSON.

His Interests: ${interests.map((interest) => interest.name).join("; ")}.

Today's Picks, best first:

${listed}

Return:
- take: one or two sentences, at most 60 words, on what today's Picks share or what stands out among them;
- picks: one entry per Pick, with its id exactly as given, a why line of at most 30 words on why it matters to Chris, and a summary of one or two sentences on what the Paper did and found, drawn from its full text where it has one.

Use only what is given above. Include no URLs, and name no Paper that is not listed.
`;
}
