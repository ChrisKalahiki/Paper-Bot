import { type Candidate, primaryId } from "./candidate.ts";
import { messageOf, PaperBotError } from "./errors.ts";
import { type Fetch, fetchOk } from "./http.ts";
import type { ScanLog } from "./log.ts";
import type { PickInput, PickToWrite } from "./prompts.ts";

/** About 10k tokens: enough of a Paper to write its why and summary, and no Briefing prompt grows past ~70k tokens. */
export const FULL_TEXT_LIMIT = 40_000;

/** Each Pick with its full text, read one at a time. A Pick whose full text is missing or unreadable is written from its abstract. */
export async function readFullTexts(fetch: Fetch, picks: PickInput[], log: ScanLog): Promise<PickToWrite[]> {
  const read: PickToWrite[] = [];
  for (const pick of picks) {
    const id = primaryId(pick.candidate);
    let fullText: string | undefined;
    try {
      fullText = await readFullText(fetch, pick.candidate);
      log(fullText === undefined ? `no full text for ${id}` : `full text for ${id}: ${fullText.length} characters`);
    } catch (error) {
      log(`no full text for ${id}: ${messageOf(error)}`);
    }
    read.push({ ...pick, fullText });
  }
  return read;
}

/**
 * A Pick's full text, cut to `FULL_TEXT_LIMIT` characters: its arXiv HTML when arXiv has some, else its open-access
 * PDF. Undefined when it has neither; a PDF that can't be read fails, naming its link.
 */
export async function readFullText(fetch: Fetch, candidate: Candidate): Promise<string | undefined> {
  const arxiv = candidate.ids.find((id) => id.startsWith("arxiv:"))?.slice("arxiv:".length);
  if (arxiv !== undefined) {
    const response = await fetch(`https://arxiv.org/html/${arxiv}`);
    const text = response.ok ? htmlText(await response.text()) : "";
    if (text !== "") return text.slice(0, FULL_TEXT_LIMIT);
  }
  if (candidate.pdf === undefined) return undefined;
  const response = await fetchOk(fetch, candidate.pdf, candidate.pdf);
  const text = await pdfText(candidate.pdf, new Uint8Array(await response.arrayBuffer()));
  return text === "" ? undefined : text.slice(0, FULL_TEXT_LIMIT);
}

/** The text of a LaTeXML page's `<article>`, or of the whole page when it has none, with math as its TeX source. */
function htmlText(html: string): string {
  const article = html.match(/<article[\s>][\s\S]*<\/article>/i)?.[0] ?? html;
  return decodeEntities(
    article
      .replace(/<(script|style|nav|header|footer)[\s>][\s\S]*?<\/\1>/gi, " ")
      .replace(/<math[^>]*\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, "$1")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

async function pdfText(url: string, bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const { text } = await extractText(await getDocumentProxy(bytes, { verbosity: 0 }), { mergePages: true });
    return text.replace(/\s+/g, " ").trim();
  } catch (error) {
    throw new PaperBotError(`${url} is not a readable PDF: ${messageOf(error)}`);
  }
}
