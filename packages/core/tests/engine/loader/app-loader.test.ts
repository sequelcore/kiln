import { describe, it, expect } from "vitest";
import { parseAppYaml, validateAppGraph, AppLoaderError } from "../../../src/engine/loader/app-loader.js";

const SAMPLE_YAML = `
name: my-app
channels: [web, cli]

memory:
  scopes: [user, "project:default"]
  backend: sqlite+fts5
  sync: git

router:
  rules:
    - match: "bug|fix"
      team: hotfix
  fallback: development

teams:
  development:
    agents:
      architect:
        tier: reasoning
        tools: []
      worker:
        tier: coding
        tools: [code_edit]
        count: 2
        sandbox: true
    workflow:
      phases: [analyze, implement, verify]
      gates:
        verify:
          requires: [tests_pass]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
    qualityGates:
      - name: test
        command: "vitest run"
        description: Run tests
        required: true
  hotfix:
    agents:
      fixer:
        tier: coding
        tools: [code_edit]
    workflow:
      phases: [fix, verify]
      gates:
        verify:
          requires: [tests_pass]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
    qualityGates:
      - name: test
        command: "vitest run"
        description: Run tests
        required: true
`;

describe("parseAppYaml", () => {
  it("parses valid YAML into correct App structure", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.name).toBe("my-app");
    expect(app.channels).toEqual(["web", "cli"]);
    expect(Object.keys(app.teams)).toContain("development");
    expect(Object.keys(app.teams)).toContain("hotfix");
  });

  it("correctly maps agents with tiers and tools", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const devTeam = app.teams["development"]!;
    const architect = devTeam.agents["architect"]!;
    expect(architect.name).toBe("architect");
    expect(architect.tier).toBe("reasoning");
    expect(architect.tools).toEqual([]);

    const worker = devTeam.agents["worker"]!;
    expect(worker.tier).toBe("coding");
    expect(worker.tools).toEqual(["code_edit"]);
    expect(worker.count).toBe(2);
    expect(worker.sandbox).toBe(true);
  });

  it("handles workflow phases and gates", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const wf = app.teams["development"]!.workflow;
    expect(wf.phases).toEqual(["analyze", "implement", "verify"]);
    expect(wf.gates["verify"]).toEqual({ requires: ["tests_pass"] });
  });

  it("handles capabilities", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const caps = app.teams["development"]!.capabilities;
    expect(caps).toHaveLength(1);
    expect(caps[0]!.name).toBe("code_edit");
    expect(caps[0]!.description).toBe("Edit code files");
    expect(caps[0]!.tags).toEqual(["coding"]);
    expect(caps[0]!.schema).toEqual({});
  });

  it("handles quality gates", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const gates = app.teams["development"]!.qualityGates;
    expect(gates).toHaveLength(1);
    expect(gates[0]!.name).toBe("test");
    expect(gates[0]!.command).toBe("vitest run");
    expect(gates[0]!.required).toBe(true);
  });

  it("handles router rules and classifier", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.router.rules).toHaveLength(1);
    expect(app.router.rules[0]!.match).toBe("bug|fix");
    expect(app.router.rules[0]!.team).toBe("hotfix");
    expect(app.router.fallback).toBe("development");
    expect(app.router.classifier).toBeUndefined();
  });

  it("handles router with classifier agent", () => {
    const yaml = `
name: app-with-classifier
channels: [web]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: main
  classifier:
    tier: fast
    tools: []

teams:
  main:
    agents:
      worker:
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.router.classifier).toBeDefined();
    expect(app.router.classifier!.tier).toBe("fast");
    expect(app.router.classifier!.name).toBe("classifier");
  });

  it("handles memory config", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.memory.scopes).toContain("user");
    expect(app.memory.scopes).toContain("project:default");
    expect(app.memory.backend).toBe("sqlite+fts5");
    expect(app.memory.sync).toBe("git");
  });

  it("handles memory config without sync", () => {
    const yaml = `
name: minimal-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.memory.sync).toBeUndefined();
  });

  it("parses minimal YAML with one team and no router rules", () => {
    const yaml = `
name: minimal-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.name).toBe("minimal-app");
    expect(Object.keys(app.teams)).toEqual(["solo"]);
    expect(app.router.rules).toHaveLength(0);
  });

  it("supports quality key as alias for qualityGates", () => {
    const yaml = `
name: alias-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    quality:
      - name: lint
        command: "biome check"
        description: Lint check
        required: true
`;
    const app = parseAppYaml(yaml);
    expect(app.teams["solo"]!.qualityGates[0]!.name).toBe("lint");
  });

  it("throws AppLoaderError for invalid YAML structure", () => {
    expect(() => parseAppYaml("not: valid: yaml:::::")).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when name is missing", () => {
    const yaml = `
channels: [web]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: main
teams:
  main:
    agents:
      w: { tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent tier is invalid", () => {
    const yaml = `
name: bad-tier
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { tier: superfast, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when YAML root is not an object", () => {
    expect(() => parseAppYaml("- just a list")).toThrow(AppLoaderError);
  });
});

describe("validateAppGraph", () => {
  it("returns null for a valid app", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(validateAppGraph(app)).toBeNull();
  });

  it("returns AppLoaderError for dangling team ref in router fallback", () => {
    // Build a valid app then mutate the router to reference a non-existent team
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = {
      ...app,
      router: { ...app.router, fallback: "nonexistent-team" },
    };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
    expect(result!.errors.some((e) => e.field.includes("router.fallback"))).toBe(true);
  });

  it("returns AppLoaderError for dangling team ref in router rules", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = {
      ...app,
      router: {
        ...app.router,
        rules: [{ match: "bug", team: "ghost-team" }],
      },
    };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
    expect(result!.errors.some((e) => e.message.includes("ghost-team"))).toBe(true);
  });

  it("returns AppLoaderError when teams is empty", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = { ...app, teams: {} };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
  });

  it("returns AppLoaderError when channels is empty", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = { ...app, channels: [] };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
  });
});
