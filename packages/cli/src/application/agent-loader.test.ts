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

  it("returns first-party defaults when both directories missing", async () => {
    const definitions = await loadAgentDefinitions(PROJECT_PATH);

    expect(findAgent(definitions, "architect")).toMatchObject({
      name: "architect",
      scope: "builtin",
      taskAffinity: ["architecture-review"],
    });
    expect(findAgent(definitions, "coder")).toMatchObject({
      name: "coder",
      scope: "builtin",
      tools: ["read", "grep", "glob", "write", "bash"],
    });
    expect(readdirSyncMock).toHaveBeenCalledWith(GLOBAL_AGENTS_DIR);
    expect(readdirSyncMock).toHaveBeenCalledWith(PROJECT_AGENTS_DIR);
  });

  it("parses canonical agent profile frontmatter", async () => {
    configureDirectories(["architect.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "architect.md")]: markdownWithFrontmatter(
        [
          "name: Architect",
          "displayName: Piama",
          "nicknameCandidates:",
          "  - Architect Piama",
          "role: System architect",
          "description: Reviews system boundaries",
          "goal: Keep architecture coherent",
          "backstory: Staff engineer perspective",
          "tier: reasoning",
          "tools:",
          "  - read",
          "  - write",
          "skills:",
          "  - sequel-spring",
          "  - refactor",
          "instructionProfiles:",
          "  - sequel-engineering",
          "mode: managed-child",
          "structured: true",
          "count: 2",
          "sandbox: true",
          "modalities:",
          "  - text",
          "authorityProfile: foundation-readonly-plan",
          "routeId: codex-oauth-readonly",
          "providerRoute:",
          "  providerId: codex-oauth",
          "  model: gpt-5.4-mini",
          "workClassification:",
          "  intents:",
          "    - review",
          "  artifacts:",
          "    - document",
          "  domains:",
          "    - business",
          "  effects:",
          "    - read-only",
          "  modes:",
          "    - critique",
        ].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false });

    expect(definitions).toEqual([
      {
        name: "Architect",
        displayName: "Piama",
        nicknameCandidates: ["Architect Piama"],
        role: "System architect",
        description: "Reviews system boundaries",
        goal: "Keep architecture coherent",
        backstory: "Staff engineer perspective",
        tier: "reasoning",
        tools: ["read", "write"],
        skills: ["sequel-spring", "refactor"],
        instructionProfiles: ["sequel-engineering"],
        mode: "managed-child",
        structured: true,
        count: 2,
        sandbox: true,
        modalities: ["text"],
        authorityProfile: "foundation-readonly-plan",
        routeId: "codex-oauth-readonly",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
        },
        workClassification: {
          intents: ["review"],
          artifacts: ["document"],
          domains: ["business"],
          effects: ["read-only"],
          modes: ["critique"],
        },
        scope: "global",
      },
    ]);
  });

  it("captures markdown body as instructions", async () => {
    configureDirectories(["planner.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "planner.md")]: markdownWithFrontmatter(
        ["name: Planner", "role: Planning specialist", "goal: Produce plans", "tier: reasoning"].join("\n"),
        "\n# Plan\n\nCreate a concrete implementation plan.\n",
      ),
    });

    const [definition] = await loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false });

    expect(definition?.instructions).toBe("# Plan\n\nCreate a concrete implementation plan.");
  });

  it("rejects agent definitions with unknown authority profiles", async () => {
    configureDirectories(["invalid.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "invalid.md")]: markdownWithFrontmatter(
        [
          "name: Invalid",
          "role: Invalid authority fixture",
          "goal: Must not load",
          "tier: reasoning",
          "authorityProfile: unrestricted",
        ].join("\n"),
      ),
    });

    await expect(loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false })).resolves.toEqual([]);
  });

  it("project agents override global agents with same name", async () => {
    configureDirectories(["shared.md", "global-only.md"], ["shared.md", "project-only.md"]);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "shared.md")]: markdownWithFrontmatter(
        ["name: Shared", "role: Global role", "goal: Global goal", "tier: fast"].join("\n"),
      ),
      [join(GLOBAL_AGENTS_DIR, "global-only.md")]: markdownWithFrontmatter(
        ["name: GlobalOnly", "role: Global only role", "goal: Global only goal", "tier: coding"].join("\n"),
      ),
      [join(PROJECT_AGENTS_DIR, "shared.md")]: markdownWithFrontmatter(
        ["name: Shared", "role: Project role", "goal: Project goal", "tier: reasoning"].join("\n"),
      ),
      [join(PROJECT_AGENTS_DIR, "project-only.md")]: markdownWithFrontmatter(
        ["name: ProjectOnly", "role: Project only role", "goal: Project only goal", "tier: fast"].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false });

    expect(definitions).toHaveLength(3);
    expect(findAgent(definitions, "shared")).toEqual({
      name: "Shared",
      role: "Project role",
      goal: "Project goal",
      tier: "reasoning",
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

    const definitions = await loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false });

    expect(definitions).toEqual([]);
  });

  it("skips files missing required canonical fields", async () => {
    configureDirectories(["missing-role.md"], []);
    configureFiles({
      [join(GLOBAL_AGENTS_DIR, "missing-role.md")]: markdownWithFrontmatter(
        ["name: MissingRole", "role: Worker"].join("\n"),
      ),
    });

    const definitions = await loadAgentDefinitions(PROJECT_PATH, { includeBuiltins: false });

    expect(definitions).toEqual([]);
  });

  it("findAgent() returns correct definition case-insensitively", () => {
    const definitions: KilnAgentDefinition[] = [
      { name: "Planner", role: "Planning specialist", goal: "Plan work", tier: "reasoning", scope: "global" },
      { name: "Code-Reviewer", role: "Review specialist", goal: "Review code", tier: "coding", scope: "project" },
    ];

    expect(findAgent(definitions, "planner")).toBe(definitions[0]);
    expect(findAgent(definitions, "CODE-REVIEWER")).toBe(definitions[1]);
  });

  it("findAgent() resolves unique display names and nicknames", () => {
    const definitions: KilnAgentDefinition[] = [
      {
        name: "tdd",
        displayName: "Malcolm",
        nicknameCandidates: ["Malcolm Wilkerson"],
        role: "TDD specialist",
        goal: "Write tests first",
        tier: "reasoning",
        scope: "global",
      },
      {
        name: "coder",
        displayName: "Reese",
        role: "Coding specialist",
        goal: "Implement code",
        tier: "coding",
        scope: "global",
      },
    ];

    expect(findAgent(definitions, "malcolm")).toBe(definitions[0]);
    expect(findAgent(definitions, "Malcolm Wilkerson")).toBe(definitions[0]);
    expect(findAgent(definitions, "reese")).toBe(definitions[1]);
  });

  it("findAgent() does not resolve ambiguous nicknames", () => {
    const definitions: KilnAgentDefinition[] = [
      {
        name: "reviewer-one",
        displayName: "Reviewer",
        role: "Review specialist",
        goal: "Review code",
        tier: "reasoning",
        scope: "global",
      },
      {
        name: "reviewer-two",
        nicknameCandidates: ["Reviewer"],
        role: "Second review specialist",
        goal: "Review code",
        tier: "reasoning",
        scope: "global",
      },
    ];

    expect(findAgent(definitions, "Reviewer")).toBeUndefined();
  });

  it("findAgent() returns undefined for unknown name", () => {
    const definitions: KilnAgentDefinition[] = [
      { name: "Planner", role: "Planning specialist", goal: "Plan work", tier: "reasoning", scope: "global" },
    ];

    expect(findAgent(definitions, "unknown")).toBeUndefined();
  });
});
