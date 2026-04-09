import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test-user"),
}));

import { findAgent, loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";

const HOME_DIR = "/home/test-user";
const PROJECT_PATH = "/workspace/project";
const GLOBAL_AGENTS_DIR = join(HOME_DIR, ".kiln", "agents");
const PROJECT_AGENTS_DIR = join(PROJECT_PATH, ".kiln", "agents");

const readdirSyncMock = readdirSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = homedir as unknown as ReturnType<typeof vi.fn>;

function throwNotFound(): never {
  const error = new Error("ENOENT");
  throw error;
}

function markdownWithFrontmatter(frontmatter: string, body = ""): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function configureDirectories(
  globalEntries?: readonly string[],
  projectEntries?: readonly string[],
): void {
  readdirSyncMock.mockImplementation((directoryPath: unknown) => {
    if (directoryPath === GLOBAL_AGENTS_DIR) {
      if (!globalEntries) throwNotFound();
      return [...globalEntries];
    }
    if (directoryPath === PROJECT_AGENTS_DIR) {
      if (!projectEntries) throwNotFound();
      return [...projectEntries];
    }
    throwNotFound();
  });
}

function configureFiles(files: Record<string, string>): void {
  readFileSyncMock.mockImplementation((filePath: unknown) => {
    const content = files[String(filePath)];
    if (content === undefined) {
      throwNotFound();
    }
    return content;
  });
}

describe("agent-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    homedirMock.mockReturnValue(HOME_DIR);
    configureDirectories();
    configureFiles({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when both directories missing", async () => {
    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(definitions).toEqual([]);
    expect(readdirSyncMock).toHaveBeenCalledWith(GLOBAL_AGENTS_DIR);
    expect(readdirSyncMock).toHaveBeenCalledWith(PROJECT_AGENTS_DIR);
  });

  it("parses frontmatter correctly (name, role, tools, model, skills)", async () => {
    configureDirectories(["architect.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "architect.md")]: markdownWithFrontmatter(
        [
          "name: Architect",
          "role: System architect",
          "tools:",
          "  - read",
          "  - write",
          "model: claude-sonnet-4-6",
          "skills:",
          "  - sequel-spring",
          "  - refactor",
        ].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(definitions).toEqual([
      {
        name: "Architect",
        role: "System architect",
        tools: ["read", "write"],
        model: "claude-sonnet-4-6",
        skills: ["sequel-spring", "refactor"],
        scope: "global",
      },
    ]);
  });

  it("captures markdown body as instructions", async () => {
    configureDirectories(["planner.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "planner.md")]: markdownWithFrontmatter(
        ["name: Planner", "role: Planning specialist"].join("\n"),
        "\n# Plan\n\nCreate a concrete implementation plan.\n",
      ),
    });

    const [definition] = await loadAgentDefinitions(PROJECT_PATH);

    expect(definition?.instructions).toBe("# Plan\n\nCreate a concrete implementation plan.");
  });

  it("project agents override global agents with same name", async () => {
    configureDirectories(["shared.md", "global-only.md"], ["shared.md", "project-only.md"]);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "shared.md")]: markdownWithFrontmatter(
        ["name: Shared", "role: Global role"].join("\n"),
      ),
      [join(GLOBAL_AGENTS_DIR, "global-only.md")]: markdownWithFrontmatter(
        ["name: GlobalOnly", "role: Global only role"].join("\n"),
      ),
      [join(PROJECT_AGENTS_DIR, "shared.md")]: markdownWithFrontmatter(
        ["name: Shared", "role: Project role"].join("\n"),
      ),
      [join(PROJECT_AGENTS_DIR, "project-only.md")]: markdownWithFrontmatter(
        ["name: ProjectOnly", "role: Project only role"].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(definitions).toHaveLength(3);
    expect(findAgent(definitions, "shared")).toEqual({
      name: "Shared",
      role: "Project role",
      scope: "project",
    });
    expect(findAgent(definitions, "globalonly")?.scope).toBe("global");
    expect(findAgent(definitions, "projectonly")?.scope).toBe("project");
  });

  it("skips files missing required name field", async () => {
    configureDirectories(["missing-name.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "missing-name.md")]: markdownWithFrontmatter(
        ["role: No name present"].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(definitions).toEqual([]);
  });

  it("skips files missing required role field", async () => {
    configureDirectories(["missing-role.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "missing-role.md")]: markdownWithFrontmatter(
        ["name: MissingRole"].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(definitions).toEqual([]);
  });

  it("findAgent() returns correct definition case-insensitively", () => {
    const definitions: KilnAgentDefinition[] = [
      { name: "Planner", role: "Planning specialist", scope: "global" },
      { name: "Code-Reviewer", role: "Review specialist", scope: "project" },
    ];

    expect(findAgent(definitions, "planner")).toBe(definitions[0]);
    expect(findAgent(definitions, "CODE-REVIEWER")).toBe(definitions[1]);
  });

  it("findAgent() returns undefined for unknown name", () => {
    const definitions: KilnAgentDefinition[] = [
      { name: "Planner", role: "Planning specialist", scope: "global" },
    ];

    expect(findAgent(definitions, "unknown")).toBeUndefined();
  });
});
