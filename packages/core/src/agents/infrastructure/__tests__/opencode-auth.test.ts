import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeAuthFile } from "../opencode-auth.js";

describe("OpenCodeAuth", () => {
  let tempDir: string;
  let tokenPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-auth-test-"));
    tokenPath = join(tempDir, "auth.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("saveAuthFile + loadAuthFile round-trip", () => {
    it("writes file and reads back identical content", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-test-key-123",
        tier: "zen",
        created_at: "2026-04-09T12:00:00.000Z",
      };

      await auth.saveAuthFile(file);
      const loaded = await auth.loadAuthFile();

      expect(loaded).toEqual(file);
    });

    it("respects custom tokenPath", async () => {
      const customPath = join(tempDir, "custom-auth.json");
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath: customPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-custom",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };

      await auth.saveAuthFile(file);
      const loaded = await auth.loadAuthFile();

      expect(loaded).toEqual(file);
    });
  });

  describe("loadAuthFile returns null when file absent", () => {
    it("returns null on ENOENT", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const result = await auth.loadAuthFile();

      expect(result).toBeNull();
    });
  });

  describe("clearAuthFile removes the file", () => {
    it("deletes existing file without error", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-test",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };
      await auth.saveAuthFile(file);
      await auth.clearAuthFile();

      const result = await auth.loadAuthFile();
      expect(result).toBeNull();
    });

    it("ignores ENOENT if file does not exist", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      await auth.clearAuthFile();
    });
  });

  describe("hasValidCredentials", () => {
    it("returns false when absent", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const result = await auth.hasValidCredentials();

      expect(result).toBe(false);
    });

    it("returns true after save with non-empty key", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-valid-key",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };
      await auth.saveAuthFile(file);
      const result = await auth.hasValidCredentials();

      expect(result).toBe(true);
    });

    it("returns false after clear", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-test",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };
      await auth.saveAuthFile(file);
      await auth.clearAuthFile();
      const result = await auth.hasValidCredentials();

      expect(result).toBe(false);
    });

    it("returns false when key is empty string", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "",
        tier: "go",
        created_at: "2026-04-09T12:00:00.000Z",
      };
      await auth.saveAuthFile(file);
      const result = await auth.hasValidCredentials();

      expect(result).toBe(false);
    });
  });

  describe("getApiKey", () => {
    it("returns saved key", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      const file: OpenCodeAuthFile = {
        api_key: "sk-my-api-key",
        tier: "zen",
        created_at: "2026-04-09T12:00:00.000Z",
      };
      await auth.saveAuthFile(file);
      const key = await auth.getApiKey();

      expect(key).toBe("sk-my-api-key");
    });

    it("throws KilnError when absent", async () => {
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      await expect(auth.getApiKey()).rejects.toThrow();
    });
  });

  describe("importFromOpenCodeConfig", () => {
    it("imports from valid source file with type api and saves with tier go", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "api", key: "sk-xyz" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).not.toBeNull();
      expect(result!.api_key).toBe("sk-xyz");
      expect(result!.tier).toBe("go");

      const loaded = await auth.loadAuthFile();
      expect(loaded).toEqual(result);
    });

    it("preserves tier override to zen", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "api", key: "sk-abc" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ tier: "zen", sourcePath });

      expect(result).not.toBeNull();
      expect(result!.tier).toBe("zen");
    });

    it("returns null if source file missing", async () => {
      const sourcePath = join(tempDir, "nonexistent.json");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).toBeNull();
    });

    it("throws KilnError on non-ENOENT read failure (e.g. EISDIR)", async () => {
      const { KilnError } = await import("../../../engine/errors.js");
      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });

      await expect(
        auth.importFromOpenCodeConfig({ sourcePath: tempDir }),
      ).rejects.toThrow(KilnError);
    });

    it("returns null if entry exists but type is not api", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "oauth", access: "token" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).toBeNull();
    });

    it("returns null if entry exists but key is missing", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "api" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).toBeNull();
    });

    it("returns null if entry exists but key is empty string", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "api", key: "" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).toBeNull();
    });

    it("falls back to access field if key is missing", async () => {
      const sourcePath = join(tempDir, "source-auth.json");
      const sourceContent = {
        opencode: { type: "api", access: "sk-fallback-key" },
      };
      await writeFile(sourcePath, JSON.stringify(sourceContent), "utf8");

      const { OpenCodeAuth } = await import("../opencode-auth.js");
      const auth = new OpenCodeAuth({ tokenPath });
      const result = await auth.importFromOpenCodeConfig({ sourcePath });

      expect(result).not.toBeNull();
      expect(result!.api_key).toBe("sk-fallback-key");
    });
  });
});