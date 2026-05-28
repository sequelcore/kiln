import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createLocalWorkspaceExplorer } from "../../src/commands/gui-workspace.js";

const execFileAsync = promisify(execFile);

describe("createLocalWorkspaceExplorer", () => {
  it("lists a directory with directories first and stable metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-workspace-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "# Kiln\n", "utf-8");

    const explorer = createLocalWorkspaceExplorer(root);
    const snapshot = await explorer.listDirectory();

    expect(snapshot.rootPath).toBe(resolve(root));
    expect(snapshot.directoryPath).toBe(resolve(root));
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["src", "README.md"]);
    expect(snapshot.entries[0]).toMatchObject({ kind: "directory" });
    expect(snapshot.entries[1]).toMatchObject({ kind: "file", sizeBytes: 7 });
  });

  it("loads text previews for supported files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-workspace-"));
    const filePath = join(root, "src.ts");
    await writeFile(filePath, "export const answer = 42;\n", "utf-8");

    const explorer = createLocalWorkspaceExplorer(root);
    const preview = await explorer.readFile(filePath);

    expect(preview).toMatchObject({
      path: resolve(filePath),
      name: "src.ts",
      kind: "text",
      encoding: "utf-8",
      content: "export const answer = 42;\n",
      language: "ts",
    });
  });

  it("rejects paths outside the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-workspace-"));
    const outside = join(tmpdir(), "outside.txt");
    await writeFile(outside, "nope", "utf-8");

    const explorer = createLocalWorkspaceExplorer(root);

    await expect(explorer.readFile(outside)).rejects.toMatchObject({
      code: "outside_workspace",
    });
  });

  it("projects git status onto workspace entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-workspace-"));
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Kiln Test"], { cwd: root });
    await writeFile(join(root, "tracked.ts"), "export const value = 1;\n", "utf-8");
    await execFileAsync("git", ["add", "tracked.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
    await writeFile(join(root, "tracked.ts"), "export const value = 2;\n", "utf-8");
    await writeFile(join(root, "untracked.ts"), "export const other = true;\n", "utf-8");

    const explorer = createLocalWorkspaceExplorer(root);
    const snapshot = await explorer.listDirectory();

    expect(snapshot.entries.find((entry) => entry.name === "tracked.ts")?.vcs).toMatchObject({
      provider: "git",
      state: "modified",
    });
    expect(snapshot.entries.find((entry) => entry.name === "untracked.ts")?.vcs).toMatchObject({
      provider: "git",
      state: "untracked",
    });
  }, 15000);

  it("projects nested git changes onto ancestor directories at the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-workspace-"));
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Kiln Test"], { cwd: root });
    await mkdir(join(root, "packages", "gui"), { recursive: true });
    await writeFile(join(root, "packages", "gui", "viewer.ts"), "export const value = 1;\n", "utf-8");
    await execFileAsync("git", ["add", "packages/gui/viewer.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
    await writeFile(join(root, "packages", "gui", "viewer.ts"), "export const value = 2;\n", "utf-8");

    const explorer = createLocalWorkspaceExplorer(root);
    const rootSnapshot = await explorer.listDirectory();
    const packagesEntry = rootSnapshot.entries.find((entry) => entry.name === "packages");
    const packagesSnapshot = await explorer.listDirectory(join(root, "packages"));
    const guiEntry = packagesSnapshot.entries.find((entry) => entry.name === "gui");

    expect(packagesEntry?.vcs).toMatchObject({
      provider: "git",
      state: "modified",
    });
    expect(guiEntry?.vcs).toMatchObject({
      provider: "git",
      state: "modified",
    });
  }, 15000);
});
