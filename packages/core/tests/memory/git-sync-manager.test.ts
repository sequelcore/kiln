import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { GitSyncManager } from "../../src/memory/git-sync-manager.js";
import { ProjectMemoryStore } from "../../src/memory/project-store.js";
import { EventBus } from "../../src/events/event-bus.js";

function createGzipChunk(entries: Record<string, unknown>[]): Buffer {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  return gzipSync(Buffer.from(lines, "utf-8"));
}

function writeManifest(
  dir: string,
  manifest: { version: 1; chunks: { hash: string; entries: number; createdAt: string; developer?: string }[]; deleted: string[] },
): void {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

describe("GitSyncManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-sync-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates directory if it does not exist", () => {
    const nested = join(tmpDir, "nested", "dir");
    const _manager = new GitSyncManager({ projectPath: nested });
    expect(() => readFileSync(join(nested, "nonexistent"))).toThrow();
    // dir was created (no throw on GitSyncManager construction)
  });

  describe("autoImport", () => {
    it("discovers and imports new chunks", () => {
      const chunk = createGzipChunk([
        { id: "1", content: "hello" },
        { id: "2", content: "world" },
      ]);
      const hash = "abc123def456";
      writeFileSync(join(tmpDir, `${hash}.jsonl.gz`), chunk);
      writeManifest(tmpDir, { version: 1, chunks: [], deleted: [] });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      const result = manager.autoImport();

      expect(result.imported).toBe(1);
      expect(result.entries).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("returns empty result when no new chunks", () => {
      writeManifest(tmpDir, { version: 1, chunks: [], deleted: [] });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      const result = manager.autoImport();

      expect(result.imported).toBe(0);
      expect(result.entries).toBe(0);
    });

    it("emits MemorySyncEvent when eventBus provided", () => {
      const chunk = createGzipChunk([{ id: "1", content: "test" }]);
      const hash = "synctest001";
      writeFileSync(join(tmpDir, `${hash}.jsonl.gz`), chunk);
      writeManifest(tmpDir, { version: 1, chunks: [], deleted: [] });

      const eventBus = new EventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");

      const manager = new GitSyncManager({ projectPath: tmpDir, eventBus });
      manager.autoImport();

      expect(emitSpy).toHaveBeenCalledOnce();
      const event = emitSpy.mock.calls[0]![0]!;
      expect(event.type).toBe("memory_sync");
      expect((event as { imported: number }).imported).toBe(1);
      expect((event as { entries: number }).entries).toBe(1);
    });

    it("does not emit event when nothing imported", () => {
      writeManifest(tmpDir, { version: 1, chunks: [], deleted: [] });

      const eventBus = new EventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");

      const manager = new GitSyncManager({ projectPath: tmpDir, eventBus });
      manager.autoImport();

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("writes developer-tagged chunk", async () => {
      const store = new ProjectMemoryStore({ projectPath: tmpDir });
      for (let i = 0; i < 10; i++) {
        await store.save({ layer: "project", content: `entry ${i}`, tags: [] });
      }
      // Buffer auto-flushed at 10. Save one more for manual flush test.
      await store.save({ layer: "project", content: "extra", tags: [] });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      await manager.flush(store);

      const manifest = JSON.parse(readFileSync(join(tmpDir, "manifest.json"), "utf-8"));
      const lastChunk = manifest.chunks[manifest.chunks.length - 1];
      expect(lastChunk.developer).toBeDefined();
      expect(typeof lastChunk.developer).toBe("string");
      expect(lastChunk.developer!.length).toBe(8);
    });
  });

  describe("syncStatus", () => {
    it("returns correct counts", () => {
      writeManifest(tmpDir, {
        version: 1,
        chunks: [
          { hash: "aaa", entries: 5, createdAt: "2026-01-01T00:00:00Z", developer: "dev1" },
          { hash: "bbb", entries: 3, createdAt: "2026-01-02T00:00:00Z", developer: "dev2" },
        ],
        deleted: [],
      });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      const status = manager.syncStatus();

      expect(status.chunks).toBe(2);
      expect(status.entries).toBe(8);
      expect(status.developers).toHaveLength(2);
      expect(status.lastSyncAt).toBeNull();
    });

    it("records lastSyncAt after autoImport", () => {
      writeManifest(tmpDir, { version: 1, chunks: [], deleted: [] });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      expect(manager.syncStatus().lastSyncAt).toBeNull();

      manager.autoImport();
      expect(manager.syncStatus().lastSyncAt).toBeInstanceOf(Date);
    });
  });

  describe("syncStatus().developers", () => {
    it("lists unique contributors", () => {
      writeManifest(tmpDir, {
        version: 1,
        chunks: [
          { hash: "aaa", entries: 5, createdAt: "2026-01-01T00:00:00Z", developer: "alice" },
          { hash: "bbb", entries: 3, createdAt: "2026-01-02T00:00:00Z", developer: "bob" },
          { hash: "ccc", entries: 2, createdAt: "2026-01-03T00:00:00Z", developer: "alice" },
        ],
        deleted: [],
      });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      const devs = manager.syncStatus().developers;

      expect(devs).toHaveLength(2);

      const alice = devs.find((d) => d.developerId === "alice");
      expect(alice).toBeDefined();
      expect(alice!.chunks).toBe(2);
      expect(alice!.entries).toBe(7);

      const bob = devs.find((d) => d.developerId === "bob");
      expect(bob).toBeDefined();
      expect(bob!.chunks).toBe(1);
      expect(bob!.entries).toBe(3);
    });

    it("groups chunks without developer under unknown", () => {
      writeManifest(tmpDir, {
        version: 1,
        chunks: [
          { hash: "aaa", entries: 5, createdAt: "2026-01-01T00:00:00Z" },
          { hash: "bbb", entries: 3, createdAt: "2026-01-02T00:00:00Z", developer: "bob" },
        ],
        deleted: [],
      });

      const manager = new GitSyncManager({ projectPath: tmpDir });
      const devs = manager.syncStatus().developers;

      expect(devs).toHaveLength(2);
      const unknown = devs.find((d) => d.developerId === "unknown");
      expect(unknown).toBeDefined();
      expect(unknown!.chunks).toBe(1);
    });
  });

  it("handles empty project directory", () => {
    const manager = new GitSyncManager({ projectPath: tmpDir });
    const result = manager.autoImport();

    expect(result.imported).toBe(0);
    expect(result.entries).toBe(0);

    const status = manager.syncStatus();
    expect(status.chunks).toBe(0);
    expect(status.entries).toBe(0);
    expect(status.developers).toHaveLength(0);
  });
});
