import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readProviderDiscoveryCache,
  providerDiscoveryCachePath,
  writeProviderDiscoveryCache,
} from "../../src/config/provider-discovery-cache.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

describe("provider discovery cache", () => {
  it("persists fresh provider discovery under private project cache state", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-"));
    const privateStateRoot = resolveProjectStateBinding(projectPath).projectStateRoot;
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
      expect(providerDiscoveryCachePath(projectPath)).toBe(
        join(privateStateRoot, "cache", "provider-discovery.json"),
      );
      expect(existsSync(join(projectPath, ".kiln"))).toBe(false);
    } finally {
      rmSync(privateStateRoot, { recursive: true, force: true });
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("does not persist stale startup projections as authoritative cache data", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-"));
    const privateStateRoot = resolveProjectStateBinding(projectPath).projectStateRoot;
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
      rmSync(privateStateRoot, { recursive: true, force: true });
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("uses the established binding when ambient XDG points at another Kiln home", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-binding-"));
    const projectPath = join(root, "project");
    const bindingHome = join(root, "binding-home");
    const ambientHome = join(root, "ambient-home");
    mkdirSync(projectPath, { recursive: true });
    vi.stubEnv("XDG_CONFIG_HOME", ambientHome);
    const binding = resolveProjectStateBinding(projectPath, { kilnHome: bindingHome });
    const discovery = [{
      provider: "codex" as const,
      available: true,
      models: ["gpt-5.4"],
      status: "available" as const,
      reason: "Codex models discovered.",
      authState: "authenticated" as const,
      lastCheckedAt: "2026-05-17T12:00:00.000Z",
    }];
    try {
      writeProviderDiscoveryCache(projectPath, discovery, { projectStateBinding: binding });

      expect(readProviderDiscoveryCache(projectPath, { projectStateBinding: binding })).toEqual(discovery);
      expect(providerDiscoveryCachePath(projectPath, { projectStateBinding: binding })).toBe(
        join(binding.cachePath, "provider-discovery.json"),
      );
      expect(existsSync(join(bindingHome, "projects"))).toBe(true);
      expect(existsSync(providerDiscoveryCachePath(projectPath))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses cache writes through a private-state junction", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-junction-"));
    const projectPath = join(root, "project");
    const outside = join(root, "outside");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(outside, { recursive: true });
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "xdg"));
    const binding = resolveProjectStateBinding(projectPath);
    mkdirSync(binding.projectStateRoot, { recursive: true });
    try {
      try {
        symlinkSync(outside, binding.cachePath, "junction");
      } catch {
        return;
      }

      expect(() => writeProviderDiscoveryCache(projectPath, [{
        provider: "codex",
        available: true,
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-17T12:00:00.000Z",
      }])).toThrow(/unsafe|canonical root/iu);
      expect(existsSync(join(outside, "provider-discovery.json"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(binding.projectStateRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read provider discovery through a private-state junction", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-provider-discovery-cache-read-junction-"));
    const projectPath = join(root, "project");
    const outside = join(root, "outside");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const outsideCache = join(outside, "provider-discovery.json");
    writeFileSync(outsideCache, JSON.stringify({
      version: 1,
      cachedAt: "2026-05-17T12:00:00.000Z",
      discovery: [{
        provider: "external",
        available: true,
        models: ["must-not-leak"],
        status: "available",
        reason: "external",
        authState: "authenticated",
        lastCheckedAt: "2026-05-17T12:00:00.000Z",
      }],
    }), "utf8");
    const binding = resolveProjectStateBinding(projectPath);
    mkdirSync(binding.projectStateRoot, { recursive: true });
    try {
      try {
        symlinkSync(outside, binding.cachePath, "junction");
      } catch {
        return;
      }

      expect(readProviderDiscoveryCache(projectPath)).toEqual([]);
      expect(readFileSync(outsideCache, "utf8")).toContain("must-not-leak");
    } finally {
      rmSync(binding.projectStateRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
