import type { Candidate } from "./candidate.ts";

export const INTERESTS_NOTE = "Research/Briefings/Interests.md";

export type Interest = { name: string; description: string; venues: string[]; avoid: string[] };

/** At most `cap` Wildcards per Daily Briefing; `hint` is Chris's word on what makes one. */
export type Wildcards = { cap: number; hint: string };

/** A Followed Group's member: the name Chris gives them, and their OpenAlex author ids, more than one when OpenAlex splits them across author records. */
export type Member = { name: string; ids: string[] };

export type FollowedGroup = { name: string; members: Member[] };

/** `issues` are what paper-bot could not read, for the Briefing's footer; the Scan goes ahead without them. */
export type InterestsNote = { interests: Interest[]; wildcards: Wildcards; followedGroups: FollowedGroup[]; issues: string[] };

export const WILDCARDS_HEADING = "Wildcards";
export const FOLLOWED_GROUPS_HEADING = "Followed Groups";
const MEMBER = /^(.+?)\s*\(([^()]+)\)$/;
const AUTHOR_ID = /^A\d+$/i;
const WILDCARD_CAP = /Up to (\d+) per Daily Briefing\.?/i;
const DEFAULT_WILDCARD_CAP = 1;

/**
 * One Interest per `## ` heading other than Wildcards: its description is the text before the first bullet, then
 * optional `- Venues:` (comma-separated) and `- Avoid:` (semicolon-separated) bullets. Venues not in `knownVenues`
 * are kept but reported. `## Followed Groups` lists one group per bullet: `- <name>: <member> (<id>, …); …`.
 */
export function parseInterestsNote(markdown: string, knownVenues: Iterable<string>): InterestsNote {
  const known = new Set(knownVenues);
  const interests: Interest[] = [];
  const issues: string[] = [];
  let wildcards: Wildcards = { cap: 0, hint: "" };
  const followedGroups: FollowedGroup[] = [];

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
    if (name === FOLLOWED_GROUPS_HEADING) {
      for (const bullet of bullets) {
        const group = readGroup(bullet, issues);
        if (group === undefined) issues.push(`unreadable Followed Group: "${bullet}"`);
        else if (group.members.length > 0) followedGroups.push(group);
      }
      continue;
    }
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
  return { interests, wildcards, followedGroups, issues };
}

/** A Followed Group bullet, or undefined when it names no group or no member; each unreadable member is an issue and is left out. */
function readGroup(bullet: string, issues: string[]): FollowedGroup | undefined {
  const [, name = "", list = ""] = bullet.match(/^-\s*([^:]+):(.*)$/) ?? [];
  const groupName = name.trim();
  const listed = list
    .split(";")
    .map((member) => member.trim())
    .filter((member) => member !== "");
  if (groupName === "" || listed.length === 0) return undefined;
  const members = listed.flatMap((member) => {
    const [, person = "", ids = ""] = member.match(MEMBER) ?? [];
    const authorIds = ids.split(",").map((id) => id.trim());
    if (person === "" || !authorIds.every((id) => AUTHOR_ID.test(id))) {
      issues.push(`unreadable member of ${groupName}: "${member}"`);
      return [];
    }
    return [{ name: person, ids: authorIds.map((id) => id.toUpperCase()) }];
  });
  return { name: groupName, members };
}

/** Every author id the Followed Groups list. */
export const followedAuthorIds = (groups: FollowedGroup[]): string[] => [...new Set(groups.flatMap((group) => group.members.flatMap((member) => member.ids)))];

/** The names of the Followed Groups with a member among the Candidate's authors. */
export function groupsOf(candidate: Candidate, groups: FollowedGroup[]): string[] {
  const authors = new Set(candidate.authorIds ?? []);
  return groups.filter((group) => group.members.some((member) => member.ids.some((id) => authors.has(id)))).map((group) => group.name);
}
