import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ADAPTER_SOURCES = ["codex-oauth.ts", "opencode.ts"] as const;

describe("provider adapter credential boundary", () => {
  it.each(ADAPTER_SOURCES)("keeps credential loading and selection out of %s", (fileName) => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../src/agents/provider-adapters", fileName),
      "utf8",
    );

    expect(source).not.toMatch(/(?:CodexOAuthAuth|OpenCodeAuth|loadAuthFile|selectCredential|fromAuth)/u);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:credential-pool|oauth-auth|opencode-auth)[^"']*["']/u);
  });
});
