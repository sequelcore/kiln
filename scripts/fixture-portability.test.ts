import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  relative,
  resolve,
} from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SYNTHETIC_USER_NAMES = new Set([
  "example",
  "exampleuser",
  "operator",
  "test",
  "test-user",
  "tester",
  "user",
  "username",
  "yourname",
]);

function listTrackedTextFiles(): string[] {
  const output = execFileSync(
    "git",
    ["grep", "-Il", "-z", "-e", "", "--", "."],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .map((file) => resolve(REPOSITORY_ROOT, file));
}

function pathRepresentations(path: string): readonly string[] {
  const normalized = path.replaceAll("/", "\\");
  return [
    normalized,
    normalized.replaceAll("\\", "/"),
    normalized.replaceAll("\\", "\\\\"),
  ];
}

function containsPathRepresentation(content: string, path: string): boolean {
  const windowsPath = /^[A-Za-z]:[\\/]/u.test(path);
  const candidate = windowsPath ? content.toLowerCase() : content;
  return pathRepresentations(path).some((value) => (
    value.length > 3
    && candidate.includes(windowsPath ? value.toLowerCase() : value)
  ));
}

function containsNonSyntheticHomePath(content: string): boolean {
  const windowsOrWslUsers = content.matchAll(
    /(?:[A-Za-z]:|\/mnt\/[a-z])[\\/]+Users[\\/]+([^\\/"'\s]+)/giu,
  );
  const posixUsers = content.matchAll(
    /(?:^|[\s"'=(\[{>`])\/(?:home|Users)\/([^/"'\s]+)/gu,
  );
  const fileUriUsers = content.matchAll(
    /file:\/\/\/(?:home|Users)\/([^/"'\s]+)/gu,
  );
  return [...windowsOrWslUsers, ...posixUsers, ...fileUriUsers].some((match) => (
    !SYNTHETIC_USER_NAMES.has(match[1]!.toLowerCase())
  ));
}

describe("repository fixture portability", () => {
  it.each([
    ["Windows raw", ["C:", "Users", "RealPerson", "project"].join("\\"), true],
    ["Windows forward slash", ["C:", "Users", "RealPerson", "project"].join("/"), true],
    ["Windows JSON escaped", ["C:", "Users", "RealPerson", "project"].join("\\\\"), true],
    ["Linux", ["", "home", "real-person", "project"].join("/"), true],
    ["macOS", ["", "Users", "RealPerson", "project"].join("/"), true],
    ["WSL", ["", "mnt", "c", "Users", "RealPerson", "project"].join("/"), true],
    ["Markdown inline code", `\`${["", "home", "RealPerson", "project"].join("/")}\``, true],
    ["HTML text", `<code>${["", "Users", "RealPerson", "project"].join("/")}</code>`, true],
    ["file URI", `file://${["", "home", "RealPerson", "project"].join("/")}`, true],
    ["synthetic Windows", ["C:", "Users", "ExampleUser", "project"].join("\\"), false],
    ["synthetic Linux", ["", "home", "test", "project"].join("/"), false],
    ["synthetic macOS", ["", "Users", "operator", "project"].join("/"), false],
    ["synthetic WSL", ["", "mnt", "c", "Users", "test-user", "project"].join("/"), false],
    ["ordinary URL path", "https://example.test/home/real-person/docs", false],
  ])("classifies %s home fixtures", (_label, fixture, expected) => {
    expect(containsNonSyntheticHomePath(fixture)).toBe(expected);
  });

  it("matches Windows workspace representations case-insensitively", () => {
    const workspace = ["C:", "Workspace", "Kiln"].join("\\");
    const lowerCaseFixture = ["c:", "workspace", "kiln", "file.ts"].join("\\");

    expect(containsPathRepresentation(lowerCaseFixture, workspace)).toBe(true);
  });

  it("does not persist the current workspace or operator home in source fixtures", () => {
    const forbidden = [REPOSITORY_ROOT, homedir()];
    const violations = listTrackedTextFiles()
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return containsNonSyntheticHomePath(content)
          || forbidden.some((path) => containsPathRepresentation(content, path));
      })
      .map((file) => relative(REPOSITORY_ROOT, file).replaceAll("\\", "/"));

    expect(violations, "Replace machine-specific values with synthetic fixtures").toEqual([]);
  });
});
