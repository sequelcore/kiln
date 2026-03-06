import { describe, it, expect } from "vitest";
import { InMemorySourceStore } from "../../../src/knowledge/infrastructure/memory-source-store.js";
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

describe("InMemorySourceStore", () => {
  it("saves and retrieves a source", () => {
    const store = new InMemorySourceStore();
    const source = makeSource();

    store.save(source);

    expect(store.get("test-app", "src-1")).toEqual(source);
  });

  it("returns undefined for unknown source", () => {
    const store = new InMemorySourceStore();

    expect(store.get("test-app", "nonexistent")).toBeUndefined();
  });

  it("lists sources filtered by appName", () => {
    const store = new InMemorySourceStore();
    store.save(makeSource({ sourceId: "s1", appName: "app-a" }));
    store.save(makeSource({ sourceId: "s2", appName: "app-a" }));
    store.save(makeSource({ sourceId: "s3", appName: "app-b" }));

    const results = store.list("app-a");
    expect(results).toHaveLength(2);
    expect(results.every((s) => s.appName === "app-a")).toBe(true);
  });

  it("removes a source", () => {
    const store = new InMemorySourceStore();
    store.save(makeSource());

    expect(store.remove("test-app", "src-1")).toBe(true);
    expect(store.get("test-app", "src-1")).toBeUndefined();
  });

  it("returns false when removing nonexistent source", () => {
    const store = new InMemorySourceStore();

    expect(store.remove("test-app", "nonexistent")).toBe(false);
  });

  it("overwrites existing source on save", () => {
    const store = new InMemorySourceStore();
    store.save(makeSource({ status: "pending" }));
    store.save(makeSource({ status: "indexed" }));

    expect(store.get("test-app", "src-1")?.status).toBe("indexed");
  });
});
