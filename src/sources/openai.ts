import { type Pointers, SOURCE_LABELS } from "../candidate.ts";
import { type Fetch, fetchOk } from "../http.ts";
import { collapse, element, rssItems } from "./rss.ts";

const FEED = "https://openai.com/news/rss.xml";

/** OpenAI's own feed category names for posts about research; the rest are company news. */
const RESEARCH_CATEGORY = /^(?:Research|Publication)$/;

/** OpenAI's research posts, pointing at Papers by title: the posts sit behind a bot wall, so the feed is all there is. */
export async function fetchOpenAiPointers(fetch: Fetch): Promise<Pointers> {
  const response = await fetchOk(fetch, FEED, SOURCE_LABELS.openai);
  const signals = rssItems(await response.text()).flatMap((item) => {
    const title = collapse(element(item, "title") ?? "");
    const categories = [...item.matchAll(/<category(?:\s[^>]*)?>[\s\S]*?<\/category>/g)].map(([category]) => element(category, "category"));
    return title !== "" && categories.some((category) => category !== undefined && RESEARCH_CATEGORY.test(category))
      ? [{ title, text: "announced by OpenAI" }]
      : [];
  });
  return { candidates: [], signals };
}
