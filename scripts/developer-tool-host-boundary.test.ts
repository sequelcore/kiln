import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const CORE_TOOLS_ROOT = resolve(REPOSITORY_ROOT, "packages", "core", "src", "tools");

const FORBIDDEN_HOST_PATTERNS = [
  { label: "host process API", pattern: /\bprocess\.(?:arch|cwd|env|execPath|kill|off|on|pid|platform)\b/u },
  { label: "Bun host API", pattern: /\bBun\./u },
  { label: "native fetch", pattern: /\bglobalThis\.fetch\b|(?<![.\w])fetch\s*\(/u },
  { label: "process module", pattern: /from\s+["']node:child_process["']/u },
  { label: "network module", pattern: /from\s+["']node:(?:dgram|dns|http|https|net|tls)[^"']*["']/u },
  { label: "MCP transport SDK", pattern: /from\s+["']@modelcontextprotocol\/(?:client|server)[^"']*["']/u },
] as const;

describe("developer tool host boundary", () => {
  it("keeps concrete process, network, and SDK execution outside Core tools", () => {
    const violations = listTypeScriptFiles(CORE_TOOLS_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return FORBIDDEN_HOST_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
        ({ label }) => `${relative(REPOSITORY_ROOT, path).replaceAll("\\", "/")}: ${label}`,
      );
    });

    expect(
      violations,
      "Core tools own contracts and deterministic policy; Runtime owns concrete host execution.",
    ).toEqual([]);
  });

  it("keeps concrete filesystem modules outside Core tool production imports", () => {
    const violations = listTypeScriptFiles(CORE_TOOLS_ROOT).flatMap((path) => {
      const lines = readFileSync(path, "utf8").split(/\r?\n/u);
      return lines.flatMap((line, index) => {
        if (!/from\s+["']node:fs(?:\/promises)?["']/u.test(line)) return [];
        if (/^\s*import\s+type\b/u.test(line)) return [];
        return [`${relative(REPOSITORY_ROOT, path).replaceAll("\\", "/")}:${index + 1}`];
      });
    });

    expect(
      violations,
      "Core may name Node filesystem types, but concrete filesystem access belongs to Runtime.",
    ).toEqual([]);
  });
});

function listTypeScriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}
