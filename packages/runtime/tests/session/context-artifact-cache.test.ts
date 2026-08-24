import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextArtifact } from "@kilnai/core/memory";
import { afterEach, describe, expect, it } from "vitest";
import {
  getProjectContextArtifactCache,
  ProjectContextArtifactCache,
} from "../../src/session/support/artifacts/context-artifact-cache.js";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function artifact(key = "summary") {
  const timestamp = "2026-08-23T00:00:00.000Z";
  return {
    key,
    kind: "repo-summary",
    content: "synthetic summary",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function runtimeArtifact(key = "summary"): ContextArtifact {
  const timestamp = new Date("2026-08-23T00:00:00.000Z");
  return {
    key,
    kind: "repo-summary",
    content: "synthetic summary",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createDirectoryLink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === "EACCES" || code === "EPERM" || code === "ENOTSUP") return false;
    throw error;
  }
}

async function waitForPersistence(cache: ProjectContextArtifactCache): Promise<void> {
  await (cache as unknown as { readonly persistChain: Promise<void> }).persistChain;
}

describe("ProjectContextArtifactCache private file ownership", () => {
  it("hydrates only from the explicit private cache file", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-context-cache-"));
    fixtures.push(root);
    const projectPath = join(root, "repository");
    const privateStateRoot = join(root, "private");
    const filePath = join(privateStateRoot, "context-artifacts.json");
    await mkdir(privateStateRoot, { recursive: true });
    await writeFile(filePath, JSON.stringify({ artifacts: [artifact()] }), "utf8");

    const cache = new ProjectContextArtifactCache(filePath, privateStateRoot);
    await cache.hydrate();

    expect(cache.get("summary")).toMatchObject({
      key: "summary",
      kind: "repo-summary",
      content: "synthetic summary",
    });
    await expect(readFile(join(projectPath, ".kiln", "context-artifacts.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists to the explicit cache file and keeps project repository state untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-context-cache-"));
    fixtures.push(root);
    const projectPath = join(root, "repository");
    const privateStateRoot = join(root, "private");
    const filePath = join(privateStateRoot, "context-artifacts.json");
    const cache = await getProjectContextArtifactCache(filePath, privateStateRoot);

    cache.set({
      key: "summary",
      kind: "repo-summary",
      content: "synthetic summary",
      createdAt: new Date("2026-08-23T00:00:00.000Z"),
      updatedAt: new Date("2026-08-23T00:00:00.000Z"),
    });

    await waitForPersistence(cache);
    await expect(readFile(filePath, "utf8")).resolves.toContain("synthetic summary");
    await expect(readFile(join(projectPath, ".kiln", "context-artifacts.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not read an external target when the cache directory becomes a junction after composition", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-context-cache-junction-read-"));
    fixtures.push(root);
    const privateStateRoot = join(root, "private");
    const cacheDirectory = join(privateStateRoot, "cache");
    const filePath = join(cacheDirectory, "context-artifacts.json");
    const outsideDirectory = join(root, "outside");
    const outsideFilePath = join(outsideDirectory, "context-artifacts.json");
    await mkdir(cacheDirectory, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(filePath, JSON.stringify({ artifacts: [artifact("inside")] }), "utf8");

    const cache = new ProjectContextArtifactCache(filePath, privateStateRoot);
    await cache.hydrate();
    expect(cache.get("inside")).toBeDefined();
    await writeFile(outsideFilePath, JSON.stringify({ artifacts: [artifact("external")] }), "utf8");
    await rm(cacheDirectory, { recursive: true, force: true });
    if (!await createDirectoryLink(outsideDirectory, cacheDirectory)) return;

    await cache.hydrate();

    expect(cache.get("external")).toBeUndefined();
    expect(cache.get("inside")).toBeDefined();
  });

  it("does not mutate an external target when set and delete persist after a cache junction swap", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-context-cache-junction-write-"));
    fixtures.push(root);
    const privateStateRoot = join(root, "private");
    const cacheDirectory = join(privateStateRoot, "cache");
    const filePath = join(cacheDirectory, "context-artifacts.json");
    const outsideDirectory = join(root, "outside");
    const outsideFilePath = join(outsideDirectory, "context-artifacts.json");
    await mkdir(cacheDirectory, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    const externalContents = JSON.stringify({ artifacts: [artifact("external")] });
    await writeFile(outsideFilePath, externalContents, "utf8");

    const cache = new ProjectContextArtifactCache(filePath, privateStateRoot);
    cache.set(runtimeArtifact("inside"));
    await waitForPersistence(cache);
    await expect(readFile(filePath, "utf8")).resolves.toContain("inside");

    await rm(cacheDirectory, { recursive: true, force: true });
    if (!await createDirectoryLink(outsideDirectory, cacheDirectory)) return;

    cache.set(runtimeArtifact("new-value"));
    await waitForPersistence(cache);
    expect(await readFile(outsideFilePath, "utf8")).toBe(externalContents);

    expect(cache.delete("inside")).toBe(true);
    await waitForPersistence(cache);
    expect(await readFile(outsideFilePath, "utf8")).toBe(externalContents);
  });
});
