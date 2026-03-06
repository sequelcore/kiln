import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { JsonSourceStore } from "../../../src/knowledge/infrastructure/json-source-store.js";
import type { KnowledgeSource } from "../../../src/engine/domain/knowledge-source.js";

function makeSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    sourceId: "src-1",
    appName: "test-app",
    name: "Test Source",
    type: "file",
    uri: "/tmp/test.txt",
    status: "pending",
    chunkCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("JsonSourceStore", () => {
  function makeDir(): string {
    return join(tmpdir(), `kiln-json-store-test-${randomUUID()}`);
  }

  it("saves and retrieves a source", () => {
    const dir = makeDir();
    const store = new JsonSourceStore(dir);
    const source = makeSource();

    store.save(source);

    expect(store.get("test-app", "src-1")).toEqual(source);
  });

  it("persists to JSON file", () => {
    const dir = makeDir();
    const store = new JsonSourceStore(dir);
    store.save(makeSource());

    const filePath = join(dir, "src-1.json");
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, "utf-8")) as KnowledgeSource;
    expect(content.sourceId).toBe("src-1");
  });

  it("loads existing files on construction", () => {
    const dir = makeDir();

    // First instance writes
    const store1 = new JsonSourceStore(dir);
    store1.save(makeSource({ sourceId: "s1", name: "First" }));
    store1.save(makeSource({ sourceId: "s2", name: "Second" }));

    // Second instance reads from disk
    const store2 = new JsonSourceStore(dir);
    expect(store2.get("test-app", "s1")?.name).toBe("First");
    expect(store2.get("test-app", "s2")?.name).toBe("Second");
    expect(store2.list("test-app")).toHaveLength(2);
  });

  it("removes source and deletes file", () => {
    const dir = makeDir();
    const store = new JsonSourceStore(dir);
    store.save(makeSource());

    expect(store.remove("test-app", "src-1")).toBe(true);
    expect(store.get("test-app", "src-1")).toBeUndefined();
    expect(existsSync(join(dir, "src-1.json"))).toBe(false);
  });

  it("returns false when removing nonexistent source", () => {
    const dir = makeDir();
    const store = new JsonSourceStore(dir);

    expect(store.remove("test-app", "nonexistent")).toBe(false);
  });

  it("lists sources filtered by appName", () => {
    const dir = makeDir();
    const store = new JsonSourceStore(dir);
    store.save(makeSource({ sourceId: "s1", appName: "app-a" }));
    store.save(makeSource({ sourceId: "s2", appName: "app-b" }));

    expect(store.list("app-a")).toHaveLength(1);
    expect(store.list("app-b")).toHaveLength(1);
  });

  it("handles nonexistent directory gracefully", () => {
    const dir = join(tmpdir(), `kiln-nonexistent-${randomUUID()}`);
    const store = new JsonSourceStore(dir);

    expect(store.list("test-app")).toHaveLength(0);
  });
});
