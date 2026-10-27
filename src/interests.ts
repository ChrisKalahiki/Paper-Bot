export const INTERESTS_NOTE = "Research/Briefings/Interests.md";

export type Interest = { name: string; description: string; venues: string[]; avoid: string[] };

/** At most `cap` Wildcards per Daily Briefing; `hint` is Chris's word on what makes one. */
export type Wildcards = { cap: number; hint: string };

/** `issues` are what paper-bot could not read, for the Briefing's footer; the Scan goes ahead without them. */
export type InterestsNote = { interests: Interest[]; wildcards: Wildcards; issues: string[] };

export const WILDCARDS_HEADING = "Wildcards";
const WILDCARD_CAP = /Up to (\d+) per Daily Briefing\.?/i;
const DEFAULT_WILDCARD_CAP = 1;

/**
 * One Interest per `## ` heading other than Wildcards: its description is the text before the first bullet, then
 * optional `- Venues:` (comma-separated) and `- Avoid:` (semicolon-separated) bullets. Venues not in `knownVenues`
 * are kept but reported.
 */
export function parseInterestsNote(markdown: string, knownVenues: Iterable<string>): InterestsNote {
  const known = new Set(knownVenues);
  const interests: Interest[] = [];
  const issues: string[] = [];
  let wildcards: Wildcards = { cap: 0, hint: "" };

  for (const section of markdown.split(/^## +/m).slice(1)) {
    const [heading = "", ...body] = section.split("\n");
    const name = heading.trim();
    const paragraph: string[] = [];
    const bullets: string[] = [];
    for (const line of body) {
      const text = line.trim();
      if (text.startsWith("- ") || text === "-") bullets.push(text);
      else if (text !== "" && bullets.length === 0) paragraph.push(text);
    }
    const description = paragraph.join(" ");
    if (name === WILDCARDS_HEADING) {
      const cap = description.match(WILDCARD_CAP);
      wildcards = { cap: cap ? Number(cap[1]) : DEFAULT_WILDCARD_CAP, hint: description.replace(WILDCARD_CAP, "").trim() };
      continue;
    }
    if (name === "") continue;

    const interest: Interest = { name, description, venues: [], avoid: [] };
    for (const bullet of bullets) {
      const [, key = "", value = ""] = bullet.match(/^-\s*([^:]*):(.*)$/) ?? [];
      const items = (separator: string) => value.split(separator).map((item) => item.trim()).filter((item) => item !== "");
      const field = key.trim().toLowerCase();
      if (field === "venues" && items(",").length > 0) interest.venues.push(...items(","));
      else if (field === "avoid" && items(";").length > 0) interest.avoid.push(...items(";"));
      else issues.push(`unreadable bullet under ${name}: "${bullet}"`);
    }
    for (const venue of interest.venues) if (!known.has(venue)) issues.push(`unknown Venue under ${name}: "${venue}"`);
    interests.push(interest);
  }
  return { interests, wildcards, issues };
}
