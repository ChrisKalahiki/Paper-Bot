export const INTERESTS_NOTE = "Research/Briefings/Interests.md";

export type Interest = { name: string; description: string };

const WILDCARDS_HEADING = "Wildcards";

/** One Interest per `## ` heading other than Wildcards; its description is the text before the first bullet. */
export function parseInterestsNote(markdown: string): Interest[] {
  const sections = markdown.split(/^## +/m).slice(1);
  return sections
    .map((section) => {
      const [heading = "", ...body] = section.split("\n");
      const paragraph: string[] = [];
      for (const line of body) {
        const text = line.trim();
        if (text.startsWith("- ")) break;
        if (text !== "") paragraph.push(text);
      }
      return { name: heading.trim(), description: paragraph.join(" ") };
    })
    .filter((interest) => interest.name !== "" && interest.name !== WILDCARDS_HEADING);
}
