import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { homeDir } = vi.hoisted(() => ({
  homeDir: `${process.env.TEMP ?? "."}/kiln-auth-test-${globalThis.crypto.randomUUID()}`,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => homeDir,
  };
});

import { runAuth } from "../../../src/commands/auth.js";

function openCodeCredential(id: string, tier: "go" | "zen", apiKey: string) {
  return {
    id,
    label: id,
    providerId: "opencode-api",
    source: "manual",
    priority: 0,
    tier,
    auth: {
      api_key: apiKey,
      tier,
      created_at: "2026-05-01T00:00:00.000Z",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("auth command", () => {
  let logs: string[];

  beforeEach(async () => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ""));
    });
    await mkdir(join(homeDir, ".kiln", "auth", "opencode-api"), { recursive: true });
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode-api", "go-primary.json"),
      `${JSON.stringify(openCodeCredential("go-primary", "go", "opencode-test-key"))}\n`,
      "utf8",
    );
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode-api", "go-exhausted.json"),
      `${JSON.stringify(openCodeCredential("go-exhausted", "go", "opencode-test-key-2"))}\n`,
      "utf8",
    );
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode-api", "zen-primary.json"),
      `${JSON.stringify(openCodeCredential("zen-primary", "zen", "opencode-zen-key"))}\n`,
      "utf8",
    );
    await mkdir(join(homeDir, ".kiln", "auth", ".health"), { recursive: true });
    await writeFile(
      join(homeDir, ".kiln", "auth", ".health", "opencode-api.json"),
      `${JSON.stringify([{
        providerId: "opencode-api",
        credentialId: "go-primary",
        requestCount: 3,
        lastSuccess: 1777593600000,
        lastExhausted: 1,
        cooldownUntil: 1,
        lastOutcome: { type: "quota-exceeded" },
        updatedAt: "2026-05-01T00:00:00.000Z",
      }, {
        providerId: "opencode-api",
        credentialId: "go-exhausted",
        requestCount: 5,
        lastSuccess: null,
        lastExhausted: Date.now(),
        cooldownUntil: Date.now() + 60_000,
        lastOutcome: { type: "quota-exceeded" },
        updatedAt: "2026-05-01T00:00:00.000Z",
      }])}\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it("prints per-entry OpenCode health columns", async () => {
    await runAuth(["opencode", "status"]);

    expect(logs.join("\n")).toContain("Name");
    expect(logs.join("\n")).toContain("Requests");
    expect(logs.join("\n")).toContain("Health");
    expect(logs.join("\n")).toContain("go-primary");
    expect(logs.join("\n")).toContain("3");
    expect(logs.join("\n")).toContain("ok");
    expect(logs.join("\n")).toContain("go-exhausted");
    expect(logs.join("\n")).toContain("5");
    expect(logs.join("\n")).toContain("exhausted");
  }, 10_000);

  it("uses pooled provider state for aggregate auth status instead of singleton auth files", async () => {
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode.json"),
      `${JSON.stringify({
        api_key: "old-opencode-key",
        tier: "go",
        created_at: "2026-04-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(homeDir, ".kiln", "auth", "codex-oauth.json"),
      `${JSON.stringify({
        access_token: "old-codex-token",
        refresh_token: "old-refresh-token",
        expires_at: "2026-04-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await runAuth(["status"]);

    const output = logs.join("\n");
    expect(output).toContain("OpenCode");
    expect(output).toContain("go-primary");
    expect(output).toContain("zen-primary");
    expect(output).not.toContain("Tier: go");
    expect(output).not.toContain("Codex OAuth");
  }, 10_000);

  it("rejects invalid OpenCode tiers instead of silently falling back to go", async () => {
    await runAuth(["opencode", "link", "--tier", "code", "--key", "sk-test"]);

    expect(logs.join("\n")).toContain("Invalid OpenCode tier 'code'. Expected 'go' or 'zen'.");
  }, 10_000);

  it("links an explicit OpenCode key under a stable caller-provided id", async () => {
    await runAuth(["opencode", "link", "--tier", "zen", "--id", "zen-work", "--key", "sk-zen-work"]);

    const raw = JSON.parse(
      await readFile(join(homeDir, ".kiln", "auth", "opencode-api", "zen-work.json"), "utf8"),
    );
    expect(raw).toEqual({
      id: "zen-work",
      label: "zen-work",
      providerId: "opencode-api",
      source: "manual",
      priority: 0,
      tier: "zen",
      auth: {
        api_key: "sk-zen-work",
        tier: "zen",
        created_at: expect.any(String),
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(logs.join("\n")).toContain("Linked OpenCode (zen) as zen-work from --key");
  }, 10_000);

  it("filters OpenCode status by tier", async () => {
    await runAuth(["opencode", "status", "--tier", "zen"]);

    expect(logs.join("\n")).toContain("zen-primary");
    expect(logs.join("\n")).not.toContain("go-primary");
  }, 10_000);

  it("logs out only the selected OpenCode credential", async () => {
    await runAuth(["opencode", "logout", "--tier", "go", "--id", "go-primary"]);
    expect(logs.join("\n")).toContain("Logged out of OpenCode credentials matching tier go and id go-primary");

    logs = [];
    await runAuth(["opencode", "status"]);

    expect(logs.join("\n")).not.toContain("go-primary");
    expect(logs.join("\n")).toContain("go-exhausted");
    expect(logs.join("\n")).toContain("zen-primary");
  }, 10_000);
});
