import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { ProjectMemoryStore } from "../../src/memory/project-store.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kiln-memsync-"));
}

describe("Orchestrator memory sync integration", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("initMemorySync creates GitSyncManager and runs autoImport", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const memDir = join(dir, "memory");

    // Place an untracked chunk
    const { mkdirSync } = require("node:fs");
    mkdirSync(memDir, { recursive: true });
    const entry = JSON.stringify({ id: "1", content: "test", layer: "project", tags: [] });
    const compressed = gzipSync(Buffer.from(entry, "utf-8"));
    const hash = require("node:crypto").createHash("sha256").update(compressed).digest("hex");
    writeFileSync(join(memDir, `${hash}.jsonl.gz`), compressed);

    const orchestrator = new Orchestrator();
    orchestrator.initMemorySync(memDir);

    const status = orchestrator.memorySyncStatus();
    expect(status).not.toBeNull();
    expect(status!.chunks).toBe(1);
    expect(status!.entries).toBe(1);
  });

  it("memorySyncStatus returns null when not initialized", () => {
    const orchestrator = new Orchestrator();
    expect(orchestrator.memorySyncStatus()).toBeNull();
  });

  it("flushMemory delegates to GitSyncManager", async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const memDir = join(dir, "memory");

    const orchestrator = new Orchestrator();
    orchestrator.initMemorySync(memDir);

    const store = new ProjectMemoryStore({ projectPath: memDir });
    await store.save({ layer: "project", content: "test entry", tags: ["test"] });

    await orchestrator.flushMemory(store);

    const status = orchestrator.memorySyncStatus();
    expect(status!.chunks).toBeGreaterThanOrEqual(1);
  });

  it("flushMemory throws when not initialized", async () => {
    const dir = makeTempDir();
    dirs.push(dir);

    const orchestrator = new Orchestrator();
    const store = new ProjectMemoryStore({ projectPath: dir });

    await expect(orchestrator.flushMemory(store)).rejects.toThrow(
      "Memory sync not initialized",
    );
  });
});
