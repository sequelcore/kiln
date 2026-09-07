import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import {
  checkLocalReference,
  readLocalReference,
  referenceStoreDirectory,
  saveLocalReference,
} from "./local-reference-workflow.js";

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kiln-local-reference-test-")));
  const root = join(directory, "repo");
  const home = join(directory, "operator", "kiln");
  mkdirSync(root);
  const config = {
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [] },
    include: ["*.ts"],
  };
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "a.ts"), "export const value = 1;\nconsole.log(value);\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe", windowsHide: true });
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
    "Fixture",
  );
  return {
    directory,
    root,
    home,
    config,
    cleanup() {
      if (
        realpathSync(directory) !== directory ||
        !directory.startsWith(join(realpathSync(tmpdir()), "kiln-local-reference-test-"))
      )
        throw new Error("invalid-cleanup-root");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("separate read/check processes preserve historical/current distinction and private placement", async () => {
  const f = fixture();
  try {
    const saved = await saveLocalReference(f.root, "tsconfig.json", "a.ts", 1, 14, f.home);
    expect(saved.status).toBe("current");
    expect(referenceStoreDirectory(f.root, f.home)).toContain(join("kiln", "projects"));
    expect(existsSync(join(f.root, ".kiln"))).toBe(false);
    for (const command of ["read", "check"]) {
      const child = spawnSync(
        "bun",
        ["run", resolve(import.meta.dirname, "local-reference-workflow.ts"), command, saved.handle, saved.hash],
        {
          cwd: f.root,
          env: { ...process.env, XDG_CONFIG_HOME: join(f.directory, "operator") },
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
        },
      );
      expect(child.status, `${command}: ${child.stderr}\n${child.stdout}`).toBe(0);
      const result: unknown = JSON.parse(child.stdout);
      expect(result).toMatchObject({ status: command === "read" ? "historical" : "current" });
    }
    expect(await checkLocalReference(f.root, saved.handle, "wrong", f.home)).toMatchObject({ status: "unavailable" });
    writeFileSync(join(referenceStoreDirectory(f.root, f.home), "context-evidence", "artifact_1.json"), "{invalid");
    expect(await checkLocalReference(f.root, saved.handle, saved.hash, f.home)).toMatchObject({
      status: "unavailable",
    });
  } finally {
    f.cleanup();
  }
}, 60000);

test("already-dirty source mutation invalidates current use without replacing historical evidence", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "a.ts"), "export const value = 2;\nconsole.log(value);\n");
    const saved = await saveLocalReference(f.root, "tsconfig.json", "a.ts", 1, 14, f.home);
    const original = readLocalReference(f.root, saved.handle, saved.hash, f.home);
    writeFileSync(join(f.root, "a.ts"), "export const value = 3;\nconsole.log(value);\n");
    expect(await checkLocalReference(f.root, saved.handle, saved.hash, f.home)).toMatchObject({
      status: "historical",
      reason: "captured-evidence-changed",
    });
    expect(readLocalReference(f.root, saved.handle, saved.hash, f.home)).toEqual(original);
  } finally {
    f.cleanup();
  }
}, 60000);

test.each(["config", "new-source"])(
  "%s changes invalidate saved evidence",
  async (change) => {
    const f = fixture();
    try {
      const saved = await saveLocalReference(f.root, "tsconfig.json", "a.ts", 1, 14, f.home);
      if (change === "config")
        writeFileSync(
          join(f.root, "tsconfig.json"),
          JSON.stringify({ ...f.config, compilerOptions: { ...f.config.compilerOptions, strict: false } }),
        );
      else writeFileSync(join(f.root, "b.ts"), 'import { value } from "./a.js";\nconsole.log(value);\n');
      expect(await checkLocalReference(f.root, saved.handle, saved.hash, f.home)).toMatchObject({
        status: "historical",
      });
    } finally {
      f.cleanup();
    }
  },
  60000,
);

test("incomplete original evidence can be retrieved but never promoted to current", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.root, "a.ts"),
      readFileSync(join(f.root, "a.ts"), "utf8") + 'import { absent } from "./missing.js";\n',
    );
    const saved = await saveLocalReference(f.root, "tsconfig.json", "a.ts", 1, 14, f.home);
    expect(saved.status).toBe("historical");
    expect(await checkLocalReference(f.root, saved.handle, saved.hash, f.home)).toMatchObject({
      status: "historical",
      reason: "original-evidence-incomplete-or-stale",
    });
    expect(readLocalReference(f.root, saved.handle, saved.hash, f.home).status).toBe("historical");
  } finally {
    f.cleanup();
  }
}, 60000);
