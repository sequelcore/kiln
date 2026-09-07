import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { expectedKeys, fixtureDirectory, fixtureNames, referenceTasks, taskRequest } from "./corpus.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";
import { captureSources, isCurrent } from "./snapshot.js";

const repository = resolve(import.meta.dirname, "../..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "kiln-reference-test-"));
const paths = fixtureNames.map((name) => `${fixtureDirectory}/${name}.ts`);
beforeAll(() => {
  mkdirSync(join(temporaryRoot, fixtureDirectory), { recursive: true });
  for (const path of paths) copyFileSync(join(repository, path), join(temporaryRoot, path));
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", temporaryRoot, ...args], { stdio: "pipe", windowsHide: true });
  };
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Fixture baseline",
  );
});
afterAll(() => {
  if (!temporaryRoot.startsWith(join(tmpdir(), "kiln-reference-test-"))) throw new Error("invalid-cleanup-root");
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test.each(referenceTasks)(
  "exact reference oracle: $id",
  async (task) => {
    const snapshot = captureSources(temporaryRoot, paths);
    for (const occurrence of task.expected) {
      const source = snapshot.sources.find((source) => source.path.endsWith(`/${occurrence.file}.ts`));
      expect(
        source?.text
          .split("\n")
          [occurrence.line - 1]?.slice(occurrence.column - 1, occurrence.column - 1 + occurrence.symbol.length),
      ).toBe(occurrence.symbol);
    }
    const adapter = new TypeScriptReferenceAdapter(snapshot);
    try {
      const result = await adapter.query(taskRequest(temporaryRoot, task));
      expect(result.disposition, JSON.stringify(result)).toBe("complete");
      expect(
        result.entries
          .map(
            (entry) =>
              `${entry.path}:${entry.range?.start.line}:${entry.range?.start.character}:${entry.symbol?.length}`,
          )
          .sort(),
      ).toEqual(expectedKeys(task));
      expect(result.cacheState).toBe("cold");
      const warm = await adapter.query(taskRequest(temporaryRoot, task));
      expect(warm.cacheState).toBe("warm");
      expect(warm.entries).toEqual(result.entries);
    } finally {
      await adapter.close();
    }
  },
  40_000,
);

test("unsupported operations, coordinates and closed adapters refuse", async () => {
  const task = referenceTasks[0];
  if (!task) throw new Error("missing-task");
  const adapter = new TypeScriptReferenceAdapter(captureSources(temporaryRoot, paths));
  const request = taskRequest(temporaryRoot, task);
  try {
    expect((await adapter.query({ ...request, operation: "hover" })).disposition).toBe("unsupported");
    expect((await adapter.query({ ...request, position: { line: -1, character: 0 } })).disposition).toBe("failed");
    expect((await adapter.query({ ...request, limit: 0 })).disposition).toBe("failed");
    expect((await adapter.query({ ...request, workspaceRoot: repository })).reasons).toEqual(["workspace-mismatch"]);
  } finally {
    await adapter.close();
  }
  expect((await adapter.query(request)).reasons).toEqual(["adapter-closed"]);
});

test("entry limits disclose partial evidence", async () => {
  const task = referenceTasks[1];
  if (!task) throw new Error("missing-task");
  const adapter = new TypeScriptReferenceAdapter(captureSources(temporaryRoot, paths));
  try {
    const result = await adapter.query({ ...taskRequest(temporaryRoot, task), limit: 1 });
    expect(result.disposition).toBe("partial");
    expect(result.omittedCount).toBe(1);
    expect(result.reasons).toContain("entry-limit");
  } finally {
    await adapter.close();
  }
});

test("missing dependency cannot prove complete references", async () => {
  const task = referenceTasks[0];
  if (!task) throw new Error("missing-task");
  const adapter = new TypeScriptReferenceAdapter(captureSources(temporaryRoot, [`${fixtureDirectory}/direct.ts`]));
  try {
    const result = await adapter.query({
      ...taskRequest(temporaryRoot, task),
      path: `${fixtureDirectory}/direct.ts`,
      position: { line: 1, character: 22 },
    });
    expect(result.disposition).toBe("partial");
    expect(result.diagnosticCodes).toContain(2307);
  } finally {
    await adapter.close();
  }
});

test("dirty, deleted and newly selected inputs change identity; stale queries fail", async () => {
  const task = referenceTasks[1];
  if (!task) throw new Error("missing-task");
  const path = join(temporaryRoot, fixtureDirectory, "shadow.ts");
  const original = readFileSync(path, "utf8");
  const captured = captureSources(temporaryRoot, paths);
  const adapter = new TypeScriptReferenceAdapter(captured);
  try {
    writeFileSync(path, `${original}\nexport const changed = 1;\n`);
    expect(isCurrent(captured)).toBe(false);
    expect(captureSources(temporaryRoot, paths).sourceDigest).not.toBe(captured.sourceDigest);
    expect((await adapter.query(taskRequest(temporaryRoot, task))).reasons).toEqual(["stale-snapshot"]);
    rmSync(path);
    expect(isCurrent(captured)).toBe(false);
    expect(() => captureSources(temporaryRoot, paths)).toThrow();
  } finally {
    writeFileSync(path, original);
    await adapter.close();
  }
  const added = `${fixtureDirectory}/added.ts`;
  try {
    writeFileSync(join(temporaryRoot, added), "export const added = 1;\n");
    expect(captureSources(temporaryRoot, [...paths, added]).sourceDigest).not.toBe(captured.sourceDigest);
  } finally {
    rmSync(join(temporaryRoot, added));
  }
});

test("path escapes and bounded input violations refuse capture", () => {
  expect(() => captureSources(temporaryRoot, ["../outside.ts"])).toThrow();
  expect(() => captureSources(temporaryRoot, [join(temporaryRoot, paths[0] ?? "")])).toThrow("absolute-source-path");
  expect(() =>
    captureSources(
      temporaryRoot,
      Array.from({ length: 129 }, () => paths[0] ?? ""),
    ),
  ).toThrow("source-file-budget");
  const oversized = `${fixtureDirectory}/oversized.ts`;
  try {
    writeFileSync(join(temporaryRoot, oversized), " ".repeat(2_097_153));
    expect(() => captureSources(temporaryRoot, [oversized])).toThrow("source-byte-budget");
  } finally {
    rmSync(join(temporaryRoot, oversized));
  }
});

test("a directory symlink cannot escape the selected workspace", () => {
  const link = join(temporaryRoot, "outside-link");
  symlinkSync(join(repository, fixtureDirectory), link, process.platform === "win32" ? "junction" : "dir");
  try {
    expect(() => captureSources(temporaryRoot, ["outside-link/origin.ts"])).toThrow("source-outside-workspace");
  } finally {
    unlinkSync(link);
  }
});

test("a concurrent request is refused while the admitted request completes", async () => {
  const task = referenceTasks[1];
  if (!task) throw new Error("missing-task");
  const adapter = new TypeScriptReferenceAdapter(captureSources(temporaryRoot, paths));
  try {
    const first = adapter.query(taskRequest(temporaryRoot, task));
    expect((await adapter.query(taskRequest(temporaryRoot, task))).reasons).toEqual(["concurrent-query"]);
    expect((await first).disposition).toBe("complete");
  } finally {
    await adapter.close();
  }
});

test("invalid UTF-8 cannot acquire a hash for silently replaced source text", () => {
  const path = `${fixtureDirectory}/invalid.ts`;
  try {
    // A truncated four-byte sequence decodes to a three-byte replacement character.
    writeFileSync(join(temporaryRoot, path), Buffer.from([0xf0, 0x9f, 0x92]));
    expect(() => captureSources(temporaryRoot, [path])).toThrow("source-changed-or-invalid-utf8");
  } finally {
    rmSync(join(temporaryRoot, path));
  }
});
