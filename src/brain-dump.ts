import { type Exec, parseJson, runCommand } from "./command.ts";
import { PaperBotError } from "./errors.ts";

const TIMEOUT_MS = 60_000;

/** paper-bot reaches the Vault only through these `brain-dump` commands. */
export type BrainDump = {
  /** The whole text of a Vault note (`show --full`). */
  show(note: string): Promise<string>;
  /** Creates a Briefing note (`write-briefing`); Brain-Dump refuses one that already exists. Returns the note's path. */
  writeBriefing(note: string, markdown: string): Promise<string>;
};

export function brainDumpCli(exec: Exec, command: string): BrainDump {
  return {
    async show(note) {
      const output = parseJson("brain-dump show", await runCommand(exec, "brain-dump show", [command, "show", note, "--full"], { timeoutMs: TIMEOUT_MS }));
      if (typeof output !== "object" || output === null || !("text" in output) || typeof output.text !== "string") {
        throw new PaperBotError("brain-dump show printed no note text");
      }
      return output.text;
    },
    async writeBriefing(note, markdown) {
      const stdout = await runCommand(exec, "brain-dump write-briefing", [command, "write-briefing", "--note", note], { stdin: markdown, timeoutMs: TIMEOUT_MS });
      const output = parseJson("brain-dump write-briefing", stdout);
      if (typeof output !== "object" || output === null || !("note" in output) || typeof output.note !== "string") {
        throw new PaperBotError("brain-dump write-briefing printed no note path");
      }
      return output.note;
    },
  };
}
