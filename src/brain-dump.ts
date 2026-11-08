import { commandOutput, type Exec, parseJson, runCommand } from "./command.ts";
import { PaperBotError } from "./errors.ts";

const TIMEOUT_MS = 60_000;

/** paper-bot reaches the Vault only through these `brain-dump` commands. */
export type BrainDump = {
  /** The whole text of a Vault note (`show --full`). */
  show(note: string): Promise<string>;
  /** Creates a Briefing note (`write-briefing`). Returns the note's path, or null when the note already exists, which Brain-Dump refuses to replace. */
  writeBriefing(note: string, markdown: string): Promise<string | null>;
  /** Writes a Kept Pick as a Dump in the Inbox (`write-dump --origin briefing`). Returns the Dump's path. */
  writeDump(dump: KeptDump): Promise<string>;
};

/** `body` is the Dump body: sections of Items only, as `write-dump` reads on stdin. */
export type KeptDump = { briefing: string; paper: string; project: string; slug: string; body: string };

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
      const options = { stdin: markdown, timeoutMs: TIMEOUT_MS };
      const result = await exec([command, "write-briefing", "--note", note], options);
      if (result.exitCode === 1 && result.stderr.includes(`${note} already exists`)) return null;
      const output = parseJson("brain-dump write-briefing", commandOutput("brain-dump write-briefing", result, options));
      if (typeof output !== "object" || output === null || !("note" in output) || typeof output.note !== "string") {
        throw new PaperBotError("brain-dump write-briefing printed no note path");
      }
      return output.note;
    },
    async writeDump(dump) {
      const path = (await runCommand(exec, "brain-dump write-dump", writeDumpArgv(command, dump), { stdin: dump.body, timeoutMs: TIMEOUT_MS })).trim();
      if (path === "") throw new PaperBotError("brain-dump write-dump printed no Dump path");
      return path;
    },
  };
}

/** `write-dump` for a Kept Pick, its body to go on stdin. */
export function writeDumpArgv(command: string, { briefing, paper, project, slug }: KeptDump): string[] {
  return [command, "write-dump", "--origin", "briefing", "--briefing", briefing, "--paper", paper, "--project", project, "--slug", slug];
}
