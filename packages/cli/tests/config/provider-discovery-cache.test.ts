import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readProviderDiscoveryCache,
  writeProviderDiscoveryCache,
} from "../../src/config/provider-discovery-cache.js";

describe("provider discovery cache", () => {
  it("persists fresh provider discovery under the project kiln cache", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-"));
    try {
      writeProviderDiscoveryCache(projectPath, [{
        provider: "codex",
        available: true,
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-17T12:00:00.000Z",
      }]);

      expect(readProviderDiscoveryCache(projectPath)).toEqual([{
        provider: "codex",
        available: true,
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-17T12:00:00.000Z",
      }]);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("does not persist stale startup projections as authoritative cache data", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-"));
    try {
      writeProviderDiscoveryCache(projectPath, [{
        provider: "codex",
        available: false,
        models: ["gpt-5.4"],
        status: "stale",
        reason: "Cached provider discovery from 2026-05-17T12:00:00.000Z; refresh is pending.",
        authState: "unknown",
        lastCheckedAt: "2026-05-17T12:00:00.000Z",
      }]);

      expect(readProviderDiscoveryCache(projectPath)).toEqual([]);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
