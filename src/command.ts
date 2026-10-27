import { homedir } from "node:os";
import { basename } from "node:path";
import { messageOf, PaperBotError } from "./errors.ts";

/** `exitCode` is null when the command was killed, as on a timeout. */
export type CommandResult = { exitCode: number | null; stdout: string; stderr: string };

/** The seam every external command (`codex`, `claude`, `brain-dump`) runs through, so tests run fakes instead. */
export type Exec = (argv: string[], options: { stdin?: string; timeoutMs: number }) => Promise<CommandResult>;

/** Runs from the home folder, so no repo's agent settings or git state leak into the call. */
export const spawnExec: Exec = async (argv, { stdin, timeoutMs }) => {
  let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    child = Bun.spawn(argv, { cwd: homedir(), stdin: "pipe", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  } catch (error) {
    throw new PaperBotError(`cannot start ${argv[0]}: ${messageOf(error)}`);
  }
  child.stdin.write(stdin ?? "");
  await child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode: child.signalCode === null ? exitCode : null, stdout, stderr };
};

/** An Exec that logs each command's exit code, or its timeout, and how long it took. */
export function loggingExec(exec: Exec, log: (message: string) => void): Exec {
  return async (argv, options) => {
    const began = Date.now();
    const result = await exec(argv, options);
    const how = result.exitCode === null ? "timed out" : `exited ${result.exitCode}`;
    log(`${basename(argv[0] ?? "")} ${argv[1] ?? ""} ${how} after ${Date.now() - began} ms`);
    return result;
  };
}

/** The command's stdout, or a PaperBotError naming `what` with its exit status and the first line it printed. */
export async function runCommand(exec: Exec, what: string, argv: string[], options: { stdin?: string; timeoutMs: number }): Promise<string> {
  const result = await exec(argv, options);
  if (result.exitCode === 0) return result.stdout;
  const status = result.exitCode === null ? `timed out after ${options.timeoutMs / 1000}s` : `exit ${result.exitCode}`;
  const said = (result.stderr.trim() || result.stdout.trim()).split("\n")[0];
  throw new PaperBotError(`${what} failed (${status})${said ? `: ${said}` : ""}`);
}

export function parseJson(what: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new PaperBotError(`${what} printed something that is not JSON`);
  }
}
