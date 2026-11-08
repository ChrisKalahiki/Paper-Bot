import { schemaFailures } from "./assertions.ts";
import { asked } from "./case.ts";
import type { Ask } from "./claude.ts";

// The advisory grade: the pinned model scores a reply 1–5 per criterion. It is printed beside the result and never gates.

export type Criterion = { name: string; ask: string };

export type Grade = { scores: Record<string, number> } | { error: string };

export async function grade(ask: Ask, criteria: Criterion[], input: string, output: string): Promise<Grade> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: criteria.map(({ name }) => name),
    properties: Object.fromEntries(criteria.map(({ name }) => [name, { type: "integer", minimum: 1, maximum: 5 }])),
  };
  const answer = await asked(ask, schema, gradingPrompt(criteria, input, output));
  if ("error" in answer) return answer;
  const { reply } = answer;
  const failures = schemaFailures(schema, reply);
  if (failures.length > 0) return { error: `grader replied off the schema: ${failures.join("; ")}` };
  return { scores: reply as Record<string, number> };
}

function gradingPrompt(criteria: Criterion[], input: string, output: string): string {
  return `Grade what a model wrote for Chris's paper-bot from the prompt it was given. Score each criterion from 1 (poor) to 5 (excellent), as JSON.

## Criteria

${criteria.map(({ name, ask }) => `- ${name}: ${ask}`).join("\n")}

## The prompt

${input}

## What it wrote

${output}
`;
}
