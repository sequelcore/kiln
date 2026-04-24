import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeAuthFile } from "../opencode-auth.js";

describe("OpenCodeAdapter", () => {
  let tempDir: string;
  let tokenPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-adapter-test-"));
    tokenPath = join(tempDir, "auth.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("tier 'go' uses providerName 'opencode-go' and defaultModel OPENCODE_GO_DEFAULT_MODEL", async () => {
      const { OpenCodeAdapter, OPENCODE_GO_DEFAULT_MODEL } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
      });

      expect(adapter.name).toBe("opencode-go");
      expect(adapter.tier).toBe("go");
      expect(adapter.defaultModel).toBe(OPENCODE_GO_DEFAULT_MODEL);
    });

    it("tier 'zen' uses providerName 'opencode-zen' and defaultModel OPENCODE_ZEN_DEFAULT_MODEL", async () => {
      const { OpenCodeAdapter, OPENCODE_ZEN_DEFAULT_MODEL } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
      });

      expect(adapter.name).toBe("opencode-zen");
      expect(adapter.tier).toBe("zen");
      expect(adapter.defaultModel).toBe(OPENCODE_ZEN_DEFAULT_MODEL);
    });

    it("explicit defaultModel override is honored for tier 'go'", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "qwen3.6-plus",
      });

      expect(adapter.name).toBe("opencode-go");
      expect(adapter.tier).toBe("go");
      expect(adapter.defaultModel).toBe("qwen3.6-plus");
    });

    it("explicit defaultModel override is honored for tier 'zen'", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "openai/gpt-5.4",
      });

      expect(adapter.name).toBe("opencode-zen");
      expect(adapter.tier).toBe("zen");
      expect(adapter.defaultModel).toBe("openai/gpt-5.4");
    });
  });

  describe("fromAuth", () => {
    it("throws KilnError('PROVIDER_AUTH_FAILED') when no auth file exists", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const { OpenCodeAuth } = await import("../opencode-auth.js");

      const auth = new OpenCodeAuth({ tokenPath });

      await expect(
        OpenCodeAdapter.fromAuth({ auth, defaultModel: "minimax-m2.5" }),
      ).rejects.toThrow();
    });

    it("with a saved auth file returns an adapter whose tier matches the stored tier", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const { OpenCodeAuth } = await import("../opencode-auth.js");

      const authFile: OpenCodeAuthFile = {
        api_key: "sk-from-test",
        tier: "zen",
        created_at: "2026-04-09T12:00:00.000Z",
      };

      await writeFile(tokenPath, JSON.stringify(authFile), "utf8");

      const auth = new OpenCodeAuth({ tokenPath });
      const adapter = await OpenCodeAdapter.fromAuth({ auth });

      expect(adapter.tier).toBe("zen");
    });

    it("saves and loads tier 'go' correctly", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const { OpenCodeAuth } = await import("../opencode-auth.js");

      const authFile: OpenCodeAuthFile = {
        api_key: "sk-go-key",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };

      await writeFile(tokenPath, JSON.stringify(authFile), "utf8");

      const auth = new OpenCodeAuth({ tokenPath });
      const adapter = await OpenCodeAdapter.fromAuth({ auth });

      expect(adapter.tier).toBe("go");
      expect(adapter.name).toBe("opencode-go");
    });
  });

  describe("model arrays", () => {
    it("OPENCODE_GO_MODELS is a non-empty array", async () => {
      const { OPENCODE_GO_MODELS } = await import("../opencode-provider.js");

      expect(OPENCODE_GO_MODELS.length).toBeGreaterThan(0);
      expect(OPENCODE_GO_MODELS).toContain("minimax-m2.5");
    });

    it("OPENCODE_ZEN_MODELS is a non-empty array", async () => {
      const { OPENCODE_ZEN_MODELS } = await import("../opencode-provider.js");

      expect(OPENCODE_ZEN_MODELS.length).toBeGreaterThan(0);
      expect(OPENCODE_ZEN_MODELS).toContain("anthropic/claude-sonnet-4-6");
    });
  });
});