import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { longDate } from "./clock.ts";
import type { Interest } from "./interests.ts";

const interestList = (interests: Interest[]): string => interests.map(({ name, description }) => `## ${name}\n${description}`).join("\n\n");

export function rankPrompt(batch: Candidate[], interests: Interest[]): string {
  const candidates = batch.map((candidate) => `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\nabstract: ${candidate.abstract}`).join("\n\n");
  return `You rank new research Papers for Chris against his Interests. Use only the titles and abstracts below; do not browse or execute commands.

His Interests:

${interestList(interests)}

For every Candidate, return:
- id: its id, exactly as given;
- interests: the names of the Interests it matches, exactly as written above; none is fine;
- score: 0 to 10, how much Chris would want to read it today; 7 or above means it belongs in today's Briefing;
- why: one line of at most 30 words on what makes it matter to Chris, or not;
- wildcard: true only when it matches no Interest but could still matter to a researcher in AI, education and HCI.

Score every Candidate exactly once.

Candidates:

${candidates}
`;
}

export type PickInput = { candidate: Candidate; ranking: Ranking };

export function dailyPrompt(picks: PickInput[], interests: Interest[], at: Date): string {
  const listed = picks
    .map(
      ({ candidate, ranking }) =>
        `id: ${primaryId(candidate)}\ntitle: ${candidate.title}\ninterests: ${ranking.interests.join(", ") || "none"}\nranking note: ${ranking.why}\nabstract: ${candidate.abstract}`,
    )
    .join("\n\n");
  return `You write the prose of Chris's Daily Briefing for ${longDate(at)}. Code lays out the note; you return only the prose, as JSON.

His Interests: ${interests.map((interest) => interest.name).join("; ")}.

Today's Picks, best first:

${listed}

Return:
- take: one or two sentences, at most 60 words, on what today's Picks share or what stands out among them;
- picks: one entry per Pick, with its id exactly as given, a why line of at most 30 words on why it matters to Chris, and a summary of one or two sentences on what the Paper did and found.

Use only what is given above. Include no URLs, and name no Paper that is not listed.
`;
}
