import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homeDir = join(tmpdir(), `kiln-auth-test-${randomUUID()}`);

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => homeDir,
  };
});

describe("auth command", () => {
  let logs: string[];

  beforeEach(async () => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ""));
    });
    await mkdir(join(homeDir, ".kiln", "auth", "opencode"), { recursive: true });
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode", "go-primary.json"),
      `${JSON.stringify({
        api_key: "opencode-test-key",
        tier: "go",
        created_at: "2026-05-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode", "go-exhausted.json"),
      `${JSON.stringify({
        api_key: "opencode-test-key-2",
        tier: "go",
        created_at: "2026-05-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(homeDir, ".kiln", "auth", "opencode", "zen-primary.json"),
      `${JSON.stringify({
        api_key: "opencode-zen-key",
        tier: "zen",
        created_at: "2026-05-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await mkdir(join(homeDir, ".kiln", "auth", ".health"), { recursive: true });
    await writeFile(
      join(homeDir, ".kiln", "auth", ".health", "opencode.json"),
      `${JSON.stringify([{
        providerId: "opencode",
        credentialId: "go-primary",
        requestCount: 3,
        lastSuccess: 1777593600000,
        lastExhausted: 1,
        cooldownUntil: 1,
        lastOutcome: { type: "quota-exceeded" },
        updatedAt: "2026-05-01T00:00:00.000Z",
      }, {
        providerId: "opencode",
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
    const { runAuth } = await import("../../../src/commands/auth.js");

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

  it("rejects invalid OpenCode tiers instead of silently falling back to go", async () => {
    const { runAuth } = await import("../../../src/commands/auth.js");

    await runAuth(["opencode", "link", "--tier", "code", "--key", "sk-test"]);

    expect(logs.join("\n")).toContain("Invalid OpenCode tier 'code'. Expected 'go' or 'zen'.");
  }, 10_000);

  it("links an explicit OpenCode key under a stable caller-provided id", async () => {
    const { runAuth } = await import("../../../src/commands/auth.js");

    await runAuth(["opencode", "link", "--tier", "zen", "--id", "zen-work", "--key", "sk-zen-work"]);

    const raw = JSON.parse(
      await readFile(join(homeDir, ".kiln", "auth", "opencode", "zen-work.json"), "utf8"),
    );
    expect(raw).toEqual({
      api_key: "sk-zen-work",
      tier: "zen",
      created_at: expect.any(String),
    });
    expect(logs.join("\n")).toContain("Linked OpenCode (zen) as zen-work from --key");
  }, 10_000);

  it("filters OpenCode status by tier", async () => {
    const { runAuth } = await import("../../../src/commands/auth.js");

    await runAuth(["opencode", "status", "--tier", "zen"]);

    expect(logs.join("\n")).toContain("zen-primary");
    expect(logs.join("\n")).not.toContain("go-primary");
  }, 10_000);

  it("logs out only the selected OpenCode credential", async () => {
    const { runAuth } = await import("../../../src/commands/auth.js");

    await runAuth(["opencode", "logout", "--tier", "go", "--id", "go-primary"]);
    expect(logs.join("\n")).toContain("Logged out of OpenCode credentials matching tier go and id go-primary");

    logs = [];
    await runAuth(["opencode", "status"]);

    expect(logs.join("\n")).not.toContain("go-primary");
    expect(logs.join("\n")).toContain("go-exhausted");
    expect(logs.join("\n")).toContain("zen-primary");
  }, 10_000);
});
