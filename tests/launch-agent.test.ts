import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fillLaunchAgent, LAUNCH_AGENT_TEMPLATE, type LaunchAgentValues } from "../scripts/install-launch-agent.ts";
import { tempDir } from "./harness.ts";

const VALUES: LaunchAgentValues = {
  bun: "/srv/home/.bun/bin/bun",
  repo: "/srv/paper-bot",
  home: "/srv/home",
  user: "chris",
  codexDir: "/srv/home/.nvm/versions/node/v24.14.0/bin",
};

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** Just enough of the XML plist format for a LaunchAgent: dict, array, key, string, integer, true and false. */
function parsePlist(xml: string): PlistValue {
  const tokens = [...xml.matchAll(/<(\/?)(\w+)(\/?)>([^<]*)/g)].map(([, closing, tag, selfClosed, text]) => ({
    closing: closing === "/",
    tag: tag ?? "",
    selfClosed: selfClosed === "/",
    text: unescapeXml(text ?? ""),
  }));
  let at = tokens.findIndex(({ tag }) => tag === "dict");
  const next = () => {
    const token = tokens[at++];
    if (token === undefined) throw new Error("the plist ends early");
    return token;
  };
  const value = (): PlistValue => {
    const { tag, selfClosed, text } = next();
    if (selfClosed) return tag === "true";
    if (tag === "string" || tag === "integer") {
      next();
      return tag === "integer" ? Number(text) : text;
    }
    const items: PlistValue[] = [];
    const entries: [string, PlistValue][] = [];
    while (!tokens[at]?.closing) {
      if (tag === "dict") {
        const key = next().text;
        next();
        entries.push([key, value()]);
      } else items.push(value());
    }
    next();
    return tag === "array" ? items : Object.fromEntries(entries);
  };
  return value();
}

function unescapeXml(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function dict(value: PlistValue | undefined): { [key: string]: PlistValue } {
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`expected a plist dict, got ${JSON.stringify(value)}`);
  return value;
}

describe("the LaunchAgent template", () => {
  const plist = dict(parsePlist(fillLaunchAgent(VALUES)));

  test("is the dev.paper-bot.scan agent the README commands name", () => {
    expect(plist.Label).toBe("dev.paper-bot.scan");
  });

  test("runs paper-bot scan with bun from the checkout", () => {
    expect(plist.ProgramArguments).toEqual(["/srv/home/.bun/bin/bun", "/srv/paper-bot/src/cli.ts", "scan"]);
  });

  test("starts at 06:00 local every day, and not at login", () => {
    expect(plist.StartCalendarInterval).toEqual({ Hour: 6, Minute: 0 });
    expect(plist.RunAtLoad).toBeUndefined();
    expect(plist.KeepAlive).toBeUndefined();
  });

  test("sets HOME, USER and LOGNAME so claude finds its login, and a PATH with codex, node, bun, claude and brain-dump", () => {
    expect(plist.EnvironmentVariables).toEqual({
      HOME: "/srv/home",
      USER: "chris",
      LOGNAME: "chris",
      PATH: "/srv/home/.nvm/versions/node/v24.14.0/bin:/srv/home/.bun/bin:/srv/home/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    });
  });

  test("writes output and errors to separate files in ~/Library/Logs/paper-bot", () => {
    expect(plist.StandardOutPath).toMatch(/^\/srv\/home\/Library\/Logs\/paper-bot\/[^/]+\.log$/);
    expect(plist.StandardErrorPath).toMatch(/^\/srv\/home\/Library\/Logs\/paper-bot\/[^/]+\.log$/);
    expect(plist.StandardErrorPath).not.toBe(plist.StandardOutPath);
  });

  test("escapes paths that hold XML's special characters", () => {
    const escaped = dict(parsePlist(fillLaunchAgent({ ...VALUES, home: "/srv/R&D <home>" })));
    expect(dict(escaped.EnvironmentVariables).HOME).toBe("/srv/R&D <home>");
  });

  test("holds no username or home path of its own", () => {
    const template = readFileSync(LAUNCH_AGENT_TEMPLATE, "utf8");
    expect(template).not.toMatch(/\/(Users|home)\//);
    expect(template).not.toContain(`/${userInfo().username}/`);
  });

  test.if(process.platform === "darwin")("passes plutil -lint once filled in", () => {
    const file = join(tempDir(), "dev.paper-bot.scan.plist");
    writeFileSync(file, fillLaunchAgent({ ...VALUES, home: "/srv/R&D <home>" }));
    expect(Bun.spawnSync(["plutil", "-lint", file]).stdout.toString()).toContain("OK");
  });
});
