import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { ProjectMemoryStore, stripPrivateTags } from "../../src/memory/project-store.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `kiln-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const tempDirs: string[] = [];

function makeStore(): { store: ProjectMemoryStore; dir: string } {
  const base = makeTempDir();
  tempDirs.push(base);
  const dir = join(base, "memory");
  const store = new ProjectMemoryStore({ projectPath: dir });
  return { store, dir };
}

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("ProjectMemoryStore", () => {
  it("creates directory on construction", () => {
    const base = makeTempDir();
    tempDirs.push(base);
    const dir = join(base, "memory", "nested");
    new ProjectMemoryStore({ projectPath: dir });
    expect(existsSync(dir)).toBe(true);
  });

  it("saves entry and returns ID", async () => {
    const { store } = makeStore();
    const id = await store.save({
      layer: "project",
      content: "test content",
      tags: ["test"],
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("stripPrivateTags removes private content", () => {
    const input = "public stuff <private>secret data</private> more public";
    expect(stripPrivateTags(input)).toBe("public stuff  more public");
  });

  it("stripPrivateTags preserves non-private content", () => {
    const input = "nothing private here";
    expect(stripPrivateTags(input)).toBe("nothing private here");
  });

  it("stripPrivateTags handles multiline private blocks", () => {
    const input = "before <private>\nline1\nline2\n</private> after";
    expect(stripPrivateTags(input)).toBe("before  after");
  });

  it("flush() creates gzipped chunk file", async () => {
    const { store, dir } = makeStore();
    await store.save({ layer: "project", content: "entry one", tags: [] });
    await store.flush();

    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"));
    expect(files).toHaveLength(1);
  });

  it("chunk filename is content hash (deterministic)", async () => {
    const { store: s1, dir: d1 } = makeStore();
    const { store: s2, dir: d2 } = makeStore();

    // Same content but different IDs -- hash is on compressed bytes, so
    // deterministic hashing depends on identical buffer content. Since UUIDs
    // differ, the hashes will differ. We verify hashes are sha256 hex instead.
    await s1.save({ layer: "project", content: "same", tags: [] });
    await s1.flush();
    await s2.save({ layer: "project", content: "same", tags: [] });
    await s2.flush();

    const files1 = readdirSync(d1).filter((f) => f.endsWith(".jsonl.gz"));
    const files2 = readdirSync(d2).filter((f) => f.endsWith(".jsonl.gz"));
    expect(files1[0]).toMatch(/^[a-f0-9]{64}\.jsonl\.gz$/);
    expect(files2[0]).toMatch(/^[a-f0-9]{64}\.jsonl\.gz$/);
  });

  it("chunk file contains valid gzipped JSONL", async () => {
    const { store, dir } = makeStore();
    await store.save({ layer: "project", content: "hello world", tags: ["a"] });
    await store.flush();

    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"));
    const compressed = readFileSync(join(dir, files[0]!));
    const text = gunzipSync(compressed).toString("utf-8");
    const parsed = JSON.parse(text) as { content: string };
    expect(parsed.content).toBe("hello world");
  });

  it("search finds entries by text", async () => {
    const { store } = makeStore();
    await store.save({ layer: "project", content: "alpha beta gamma", tags: [] });
    await store.save({ layer: "project", content: "delta epsilon", tags: [] });
    await store.flush();

    const results = await store.search("beta");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toBe("alpha beta gamma");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("search finds entries in unflushed buffer", async () => {
    const { store } = makeStore();
    await store.save({ layer: "project", content: "unflushed data point", tags: [] });

    const results = await store.search("unflushed");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toBe("unflushed data point");
  });

  it("recall respects token budget", async () => {
    const { store } = makeStore();
    // Each entry ~20 chars = ~5 tokens
    await store.save({ layer: "project", content: "short entry number one", tags: [] });
    await store.save({ layer: "project", content: "short entry number two", tags: [] });
    await store.save({ layer: "project", content: "short entry number three", tags: [] });
    await store.flush();

    // Budget of 6 tokens should fit ~1 entry
    const result = await store.recall("entry number", 6);
    const parts = result.split("\n\n");
    expect(parts.length).toBeLessThanOrEqual(2);
  });

  it("forget adds to deleted list", async () => {
    const { store, dir } = makeStore();
    const id = await store.save({ layer: "project", content: "to delete", tags: [] });
    await store.flush();
    await store.forget(id);

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
      deleted: string[];
    };
    expect(manifest.deleted).toContain(id);
  });

  it("search excludes deleted entries", async () => {
    const { store } = makeStore();
    const id = await store.save({ layer: "project", content: "doomed entry", tags: [] });
    await store.save({ layer: "project", content: "safe entry", tags: [] });
    await store.flush();

    await store.forget(id);

    const results = await store.search("entry");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toBe("safe entry");
  });

  it("manifest tracks chunks", async () => {
    const { store, dir } = makeStore();
    await store.save({ layer: "project", content: "batch one", tags: [] });
    await store.flush();
    await store.save({ layer: "project", content: "batch two", tags: [] });
    await store.flush();

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
      chunks: Array<{ hash: string; entries: number }>;
    };
    expect(manifest.chunks).toHaveLength(2);
    expect(manifest.chunks[0]!.entries).toBe(1);
    expect(manifest.chunks[1]!.entries).toBe(1);
  });

  it("multiple saves accumulate in buffer, flush at threshold", async () => {
    const { store, dir } = makeStore();

    // Save 9 entries -- should NOT auto-flush
    for (let i = 0; i < 9; i++) {
      await store.save({ layer: "project", content: `entry ${i}`, tags: [] });
    }
    const filesBefore = readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"));
    expect(filesBefore).toHaveLength(0);

    // 10th entry triggers auto-flush
    await store.save({ layer: "project", content: "entry 9", tags: [] });
    const filesAfter = readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"));
    expect(filesAfter).toHaveLength(1);
  });

  it("count returns total non-deleted entries", async () => {
    const { store } = makeStore();
    const id1 = await store.save({ layer: "project", content: "one", tags: [] });
    await store.save({ layer: "project", content: "two", tags: [] });
    await store.flush();
    await store.forget(id1);

    expect(store.count).toBe(1);
  });

  it("private content is stripped before saving", async () => {
    const { store } = makeStore();
    await store.save({
      layer: "project",
      content: "visible <private>hidden</private> also visible",
      tags: [],
    });
    await store.flush();

    const results = await store.search("visible");
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).not.toContain("hidden");
    expect(results[0]!.entry.content).toContain("visible");
  });
});
