/** An expected failure, reported as one line without a stack trace. */
export class PaperBotError extends Error {
  override name = "PaperBotError";
}

export class UsageError extends PaperBotError {
  override name = "UsageError";
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
