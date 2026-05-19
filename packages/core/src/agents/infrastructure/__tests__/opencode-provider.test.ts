import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeAuthFile } from "../opencode-auth.js";

describe("OpenCodeAdapter", () => {
  let tempDir: string;
  let tokenPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-adapter-test-"));
    tokenPath = join(tempDir, "auth.json");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("tier 'go' uses providerName 'opencode-go' and the selected model", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "minimax-m2.5",
      });

      expect(adapter.name).toBe("opencode-go");
      expect(adapter.tier).toBe("go");
      expect(adapter.defaultModel).toBe("minimax-m2.5");
    });

    it("tier 'zen' uses providerName 'opencode-zen' and the selected model", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "anthropic/claude-sonnet-4-6",
      });

      expect(adapter.name).toBe("opencode-zen");
      expect(adapter.tier).toBe("zen");
      expect(adapter.defaultModel).toBe("anthropic/claude-sonnet-4-6");
    });

    it("fails fast when the selected model is blank", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");

      expect(() => new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "   ",
      })).toThrow("OpenCode adapter requires a selected model");
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

    it("routes tier 'go' chat calls through the OpenCode Go subscription endpoint", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "minimax-m2.5",
      });

      await adapter.createMessage({
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/chat/completions",
        expect.any(Object),
      );
    });

    it("routes tier 'zen' chat calls through the OpenCode Zen endpoint", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "anthropic/claude-sonnet-4-6",
      });

      await adapter.createMessage({
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.ai/zen/v1/chat/completions",
        expect.any(Object),
      );
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

    it("fails fast when fromAuth receives a blank selected model", async () => {
      const { OpenCodeAdapter } = await import("../opencode-provider.js");
      const { OpenCodeAuth } = await import("../opencode-auth.js");

      const authFile: OpenCodeAuthFile = {
        api_key: "sk-from-test",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };

      await writeFile(tokenPath, JSON.stringify(authFile), "utf8");

      const auth = new OpenCodeAuth({ tokenPath });

      await expect(
        OpenCodeAdapter.fromAuth({ auth, defaultModel: "   " }),
      ).rejects.toThrow("OpenCode adapter requires a selected model");
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
      const adapter = await OpenCodeAdapter.fromAuth({ auth, defaultModel: "anthropic/claude-sonnet-4-6" });

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
      const adapter = await OpenCodeAdapter.fromAuth({ auth, defaultModel: "minimax-m2.5" });

      expect(adapter.tier).toBe("go");
      expect(adapter.name).toBe("opencode-go");
    });
  });
});
