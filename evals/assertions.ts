import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avoidedTermsIn } from "../scripts/glossary.ts";
import { dayAndMonth, localDate } from "../src/clock.ts";
import { KEEP_SCHEMA } from "../src/keep.ts";
import { THEMES_SCHEMA } from "../src/weekly.ts";
import { DAILY_SCHEMA } from "../src/write.ts";

// The deterministic checks that gate an eval: what the model wrote against its schema, its fixture and the prompt it was given.

/** The JSON Schema subset paper-bot's `--json-schema` schemas use. */
export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

/** Every way `value` breaks `schema`, each naming where; empty when it conforms. */
export function schemaFailures(schema: JsonSchema, value: unknown, path = ""): string[] {
  const where = path || "the reply";
  switch (schema.type) {
    case "string":
      return typeof value === "string" ? [] : [`${where} is not a string`];
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return [`${where} is not a whole number`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${where} is ${value}, below ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${where} is ${value}, above ${schema.maximum}`];
      return [];
    case "array": {
      if (!Array.isArray(value)) return [`${where} is not a list`];
      const failures: string[] = [];
      if (schema.minItems !== undefined && value.length < schema.minItems) failures.push(`${where} has ${value.length} entries, fewer than ${schema.minItems}`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) failures.push(`${where} has ${value.length} entries, more than ${schema.maxItems}`);
      const { items } = schema;
      return items === undefined ? failures : [...failures, ...value.flatMap((item, i) => schemaFailures(items, item, `${path}[${i}]`))];
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${where} is not an object`];
      const properties = schema.properties ?? {};
      const fields = value as Record<string, unknown>;
      const field = (key: string) => (path ? `${path}.${key}` : key);
      return [
        ...(schema.required ?? []).filter((key) => !(key in fields)).map((key) => `${field(key)} is missing`),
        ...(schema.additionalProperties === false ? Object.keys(fields).filter((key) => !(key in properties)).map((key) => `${field(key)} is not in the schema`) : []),
        ...Object.entries(properties).flatMap(([key, property]) => (key in fields ? schemaFailures(property, fields[key], field(key)) : [])),
      ];
    }
    default:
      throw new Error(`schemaFailures cannot check a schema of type ${schema.type}`);
  }
}

const GLOSSARY = readFileSync(join(import.meta.dir, "..", "GLOSSARY.md"), "utf8");

export const words = (text: string): number => text.split(/\s+/).filter((word) => /\w/.test(word)).length;

/** Abbreviations whose full stop ends no sentence. */
const ABBREVIATIONS = /\b(?:e\.g|i\.e|et al|vs|cf|approx|Fig|Eq)\./gi;

const URL = /https?:\/\/[^\s<>"'`]+/g;
const DOI = /\b10\.\d{4,9}\/[^\s<>"'`]+/g;

/** Sentences, counted by their closing `.`, `!` or `?`; a last one may go without. Links don't count, and their dots end nothing. */
export function sentences(text: string): number {
  const plain = text.replace(URL, "").replace(ABBREVIATIONS, "").trim();
  if (plain === "") return 0;
  const closed = plain.match(/[.!?]+(?=\s|$)/g)?.length ?? 0;
  return /[.!?]["'”)\]*]*$/.test(plain) ? closed : closed + 1;
}

/** URLs, arXiv ids, DOIs and quoted or italic titles of three or more words in `text` that `input` never mentions. */
export function inventedReferences(text: string, input: string): string[] {
  const normal = (reference: string) => reference.toLowerCase().replace(/\s+/g, " ");
  const known = normal(input);
  const trimmed = (found: string) => found.replace(/[.,;:!?)\]]+$/, "");
  const urls = [...text.matchAll(URL)].map(([url]) => trimmed(url));
  const prose = text.replace(URL, " ");
  const dois = [...prose.matchAll(DOI)].map(([doi]) => trimmed(doi));
  const arxivIds = [...prose.replace(DOI, " ").matchAll(/(?<![\d.])\d{4}\.\d{4,5}(?:v\d+)?(?!\d)/g)].map(([id]) => id);
  const titles = [...prose.matchAll(/["“]([^"”\n]+)["”]|\*+([^*\n]+)\*+|(?<!\w)_([^_\n]+)_(?!\w)/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim())
    .filter((title) => words(title) >= 3);
  return [
    ...[...urls, ...arxivIds, ...dois].filter((reference) => !known.includes(normal(reference))),
    ...titles.filter((title) => !known.includes(normal(title))).map((title) => `"${title}"`),
  ].map((reference) => `names ${reference}, which is not in the input`);
}

export function avoidedTermFailures(text: string): string[] {
  return avoidedTermsIn(text, GLOSSARY).map((term) => `uses "${term}", an avoided Glossary term`);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A day is named by its ISO date, or by its day of the month alongside its month's name, as in "Oct 24–26". */
function namesDay(text: string, day: Date): boolean {
  if (text.includes(localDate(day))) return true;
  const month = MONTHS[day.getMonth()] ?? "";
  return new RegExp(`\\b(?:${month}|${month.slice(0, 3)})\\b`, "i").test(text) && new RegExp(`(?<![\\d.])${day.getDate()}(?:st|nd|rd|th)?(?!\\d)`).test(text);
}

export type DailyExpectation = {
  /** The Picks' ids, as the prompt gives them. */
  ids: string[];
  /** The days a catch-up Briefing covers, which its take must name. */
  covers?: { from: Date; to: Date };
};

/** Every way a Daily Briefing's prose misses the checks; empty when it passes. `prompt` is what the writer was given. */
export function checkDaily(reply: unknown, expected: DailyExpectation, prompt: string): string[] {
  const offSchema = schemaFailures(DAILY_SCHEMA, reply);
  if (offSchema.length > 0) return offSchema;
  const { take, picks } = reply as { take: string; picks: { id: string; why: string; summary: string }[] };
  const failures: string[] = [];
  for (const id of expected.ids) {
    const entries = picks.filter((pick) => pick.id === id).length;
    if (entries !== 1) failures.push(entries === 0 ? `${id} has no entry` : `${id} has ${entries} entries`);
  }
  for (const { id } of picks) if (!expected.ids.includes(id)) failures.push(`${id} is not a Pick`);
  if (words(take) > 60) failures.push(`the take has ${words(take)} words, over 60`);
  for (const { id, why, summary } of picks) {
    if (words(why) > 30) failures.push(`the why of ${id} has ${words(why)} words, over 30`);
    if (sentences(summary) > 2) failures.push(`the summary of ${id} has ${sentences(summary)} sentences, over 2`);
  }
  if (expected.covers !== undefined) {
    for (const day of [expected.covers.from, expected.covers.to]) if (!namesDay(take, day)) failures.push(`the take of a catch-up never names ${dayAndMonth(day)}`);
  }
  const prose = [take, ...picks.flatMap(({ why, summary }) => [why, summary])].join("\n");
  return [...failures, ...inventedReferences(prose, prompt), ...avoidedTermFailures(prose)];
}

const WEEKLY_THEMES: [min: number, max: number] = [2, 4];

/** A theme cites a Pick by its title, or by the short name before a colon in it, as in "TutorBench". */
function cites(text: string, title: string): boolean {
  const lower = text.toLowerCase();
  const short = title.split(":")[0]?.trim() ?? "";
  return lower.includes(title.toLowerCase()) || (title.includes(":") && short.length >= 4 && lower.includes(short.toLowerCase()));
}

/** Every way a Weekly Briefing's themes miss the checks; empty when they pass. `titles` are the week's Picks'. */
export function checkWeekly(reply: unknown, titles: string[], prompt: string): string[] {
  const offSchema = schemaFailures(THEMES_SCHEMA, reply);
  if (offSchema.length > 0) return offSchema;
  const { themes } = reply as { themes: { headline: string; body: string }[] };
  const [min, max] = WEEKLY_THEMES;
  const failures = themes.length < min || themes.length > max ? [`${themes.length} theme${themes.length === 1 ? "" : "s"}, expected ${min}–${max}`] : [];
  for (const { headline, body } of themes) {
    const cited = titles.filter((title) => cites(`${headline} ${body}`, title)).length;
    if (cited < 2) failures.push(`the theme "${headline}" cites ${cited} Pick${cited === 1 ? "" : "s"}, fewer than 2`);
  }
  return [...failures, ...inventedReferences(themes.map(({ headline, body }) => `${headline}\n${body}`).join("\n"), prompt)];
}

/** Openers that point back at another Learning or the header, so the Learning can't be filed on its own. */
const LEANS_ON = /^(?:it|its|this|these|that|those|they|their|also|additionally|furthermore|moreover|however|similarly)\b/i;

/** Every way a Keep's draft misses the checks; empty when it passes. Whether `write-dump` takes it is checked apart. */
export function checkKeep(reply: unknown, prompt: string): string[] {
  const offSchema = schemaFailures(KEEP_SCHEMA, reply);
  if (offSchema.length > 0) return offSchema;
  const { header, learnings } = reply as { header: string; learnings: string[] };
  const failures = learnings.flatMap((learning, i) => {
    const n = i + 1;
    const lines = learning.trim().split("\n").length;
    if (lines > 1) return [`Learning ${n} runs over ${lines} lines`];
    const count = sentences(learning);
    if (count > 1) return [`Learning ${n} is ${count} sentences, not one statement: "${learning}"`];
    return LEANS_ON.test(learning.trim()) ? [`Learning ${n} leans on what came before it: "${learning}"`] : [];
  });
  return [...failures, ...inventedReferences([header, ...learnings].join("\n"), prompt)];
}

/** Each Top Pick a rendered Weekly Briefing links that is not one of `urls`, the week's Picks. */
export function checkTopPicks(markdown: string, urls: string[]): string[] {
  const section = markdown.match(/^## Top Picks\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] ?? "";
  return [...section.matchAll(/^- \[ \] Keep \[.*?\]\((\S+)\)/gm)]
    .map(([, url = ""]) => url)
    .filter((url) => !urls.includes(url))
    .map((url) => `the Top Pick ${url} is not one of the week's Picks`);
}
