import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "../src/candidate.ts";
import { localDate } from "../src/clock.ts";
import { httpFetch } from "../src/http.ts";
import { fetchArxivCandidates } from "../src/sources/arxiv.ts";
import { OPENALEX_FIELDS, toCandidate, WORKS, type Work } from "../src/sources/openalex.ts";
import { EXAMPLE_CONFIG } from "./claude.ts";
import { RANK_FIXTURES, type RankFixture } from "./rank.ts";

// `bun evals/refresh-rank-fixture.ts [--discard-labels]`: freezes today's real Candidates as the rank eval's day, each with an empty label.
// It makes one arXiv RSS request and one OpenAlex request with no API key, both read-only, and won't overwrite labels unless told to discard them.

const ARXIV_SAMPLE = 80;
const OPENALEX_SAMPLE = 16;
/** OpenAlex's Education and Human-Computer Interaction subfields, as the Scan fetches them. */
const SUBFIELDS = "3304|1709";

async function main(argv: string[]): Promise<number> {
  const path = join(import.meta.dir, "..", RANK_FIXTURES.day);
  if (existsSync(path) && !argv.includes("--discard-labels")) {
    const labelled = (JSON.parse(readFileSync(path, "utf8")) as RankFixture).candidates.filter(({ label }) => label !== "").length;
    if (labelled > 0) {
      console.error(`refresh: ${RANK_FIXTURES.day} has ${labelled} labels; pass --discard-labels to replace them with a new day`);
      return 1;
    }
  }
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const arxiv = await fetchArxivCandidates(httpFetch, EXAMPLE_CONFIG.arxiv.categories);
  const arxivIds = new Set(arxiv.flatMap(({ ids }) => ids));
  const filter = `primary_topic.subfield.id:${SUBFIELDS},from_publication_date:${localDate(yesterday)},to_publication_date:${localDate(today)},has_abstract:true`;
  const response = await httpFetch(`${WORKS}?${new URLSearchParams({ filter, select: OPENALEX_FIELDS, "per-page": "200" })}`);
  if (!response.ok) {
    console.error(`refresh: OpenAlex answered ${response.status}`);
    return 1;
  }
  const works = ((await response.json()) as { results?: Work[] }).results ?? [];
  const openalex = works.flatMap((work) => toCandidate(work, {}) ?? []).filter(({ ids, abstract }) => abstract !== "" && !ids.some((id) => arxivIds.has(id)));

  const fixture: RankFixture = {
    day: localDate(today),
    candidates: [...spread(arxiv, ARXIV_SAMPLE), ...spread(openalex, OPENALEX_SAMPLE)].map((candidate) => ({ label: "", candidate })),
  };
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`froze ${fixture.candidates.length} Candidates for ${fixture.day}, of ${arxiv.length} from arXiv and ${openalex.length} from OpenAlex, in ${RANK_FIXTURES.day}`);
  return 0;
}

/** `count` Candidates evenly spaced through the list, so the sample spans every category rather than the first. */
function spread(candidates: Candidate[], count: number): Candidate[] {
  if (candidates.length <= count) return candidates;
  return Array.from({ length: count }, (_, i) => candidates[Math.floor((i * candidates.length) / count)]).filter((candidate) => candidate !== undefined);
}

process.exitCode = await main(process.argv.slice(2));
