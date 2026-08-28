import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileConfigMutation } from "../../src/application/config-mutation-reconciliation.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const mocks = vi.hoisted(() => ({
  globalConfig: { version: "6", modelGateway: { enabled: true } } as Record<string, unknown> | null,
  routeAuthority: { executionCatalog: { targets: [{ id: "terra" }] } } as unknown,
  syncPermissions: vi.fn(),
  syncAgents: vi.fn(),
  syncWorkflowSnapshot: vi.fn(),
  loadConfigWithAuthority: vi.fn(),
  generations: new Map<string, string>(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  globalToKilnYaml: (config: unknown) => ({ version: "1", source: config }),
  loadKilnConfig: vi.fn(),
  loadKilnConfigWithGlobalAuthority: mocks.loadConfigWithAuthority,
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: () => mocks.globalConfig,
  readGlobalExecutionTargetAuthority: () => mocks.routeAuthority,
  resolveGlobalConfigPath: () => `${process.env.TEMP ?? process.cwd()}/kiln-reconciliation-fixture/config.yaml`,
}));

vi.mock("../../src/config/native-permission-projection.js", () => ({
  syncNativePermissionProjections: mocks.syncPermissions,
}));

vi.mock("../../src/config/native-agent-projection.js", () => ({ syncNativeAgentProjections: mocks.syncAgents }));
vi.mock("../../src/config/native-skill-projection.js", () => ({ syncNativeSkillProjections: vi.fn() }));
vi.mock("../../src/application/workflow-snapshot-projection.js", () => ({
  syncWorkflowSnapshotProjection: mocks.syncWorkflowSnapshot,
}));
vi.mock("../../src/config/communication-policy.js", () => ({ configuredCommunicationCandidates: vi.fn() }));
vi.mock("../../src/kiln-yaml.js", () => ({ readKilnYamlFile: vi.fn() }));
vi.mock("../../src/application/config-reconciliation-generation.js", () => ({
  captureCanonicalReconciliationGeneration: (_projectPath: string, target: string) => mocks.generations.get(target) ?? `sha256:${"a".repeat(64)}`,
}));

describe("configuration mutation reconciliation", () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let kilnHome: string;
  const previousTemp = process.env.TEMP;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-reconciliation-"));
    projectRoot = join(fixtureRoot, "project");
    kilnHome = join(fixtureRoot, "kiln-home");
    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    const binding = resolveProjectStateBinding(projectRoot, { kilnHome });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.configPath, 'version: "1"\n', "utf-8");
    process.env.TEMP = fixtureRoot;
    process.env.XDG_CONFIG_HOME = join(fixtureRoot, "xdg");
    mocks.globalConfig = { version: "6", modelGateway: { enabled: true } };
    mocks.routeAuthority = { executionCatalog: { targets: [{ id: "terra" }] } };
    mocks.syncPermissions.mockReset().mockResolvedValue({ errors: [], outcomes: [] });
    mocks.syncAgents.mockReset().mockResolvedValue({ errors: [], synced: 1 });
    mocks.syncWorkflowSnapshot.mockReset().mockResolvedValue({ errors: [], written: true, outcomes: [] });
    mocks.loadConfigWithAuthority.mockReset().mockResolvedValue({ kilnYaml: { version: "1" }, globalConfig: mocks.globalConfig });
    mocks.generations.clear();
  });

  afterEach(() => {
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("converges native permission projections from committed global intent", async () => {
    const [effect] = await reconcileConfigMutation(projectRoot, ["native-permissions"], { kilnHome });

    expect(mocks.syncPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1" }),
      projectRoot,
      expect.objectContaining({ force: true, modelGateway: { enabled: true } }),
    );
    expect(effect).toMatchObject({ target: "native-permissions", status: "ok", generation: `sha256:${"a".repeat(64)}` });
  });

  it("reports native projection errors as reconciliation failure after commit", async () => {
    mocks.syncPermissions.mockResolvedValue({ errors: ["Codex: managed field drift"], outcomes: [] });

    const [effect] = await reconcileConfigMutation(projectRoot, ["native-permissions"], { kilnHome });

    expect(effect).toMatchObject({
      target: "native-permissions",
      status: "failed",
      errors: ["Codex: managed field drift"],
    });
  });

  it("reads the committed target intent with its exact evidence before reporting targets reconciled", async () => {
    const [effect] = await reconcileConfigMutation(projectRoot, ["execution-targets"], { kilnHome });

    expect(effect).toEqual({
      target: "execution-targets",
      status: "ok",
      summary: "1 execution targets verified from canonical intent and evidence.",
      errors: [],
      generation: `sha256:${"a".repeat(64)}`,
    });
  });

  it("reconciles the private workflow snapshot without writing repository instructions", async () => {
    const [effect] = await reconcileConfigMutation(projectRoot, ["workflow-snapshot"], { kilnHome });

    expect(mocks.syncWorkflowSnapshot).toHaveBeenCalledWith(projectRoot, {
      projectStateBinding: expect.objectContaining({ canonicalRoot: projectRoot }),
    });
    expect(effect).toMatchObject({
      target: "workflow-snapshot",
      status: "ok",
      generation: `sha256:${"a".repeat(64)}`,
    });
  });

  it("serializes same-target work from different canonical paths and supersedes older generations", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstDidStart = new Promise<void>((resolve) => { firstStarted = resolve; });
    let callCount = 0;
    let publishedGeneration = "none";
    mocks.syncAgents.mockImplementation(async () => {
      callCount += 1;
      const admittedGeneration = mocks.generations.get("native-agents") ?? `sha256:${"a".repeat(64)}`;
      if (callCount === 1) {
        firstStarted();
        await firstMayFinish;
      }
      publishedGeneration = admittedGeneration;
      return { errors: [], synced: 1 };
    });

    const first = reconcileConfigMutation(projectRoot, ["native-agents"], { kilnHome });
    await Promise.race([
      firstDidStart,
      first.then((result) => { throw new Error(`First reconciliation completed before its projection started: ${JSON.stringify(result)}`); }, (error) => { throw error; }),
    ]);
    const newerGeneration = `sha256:${"b".repeat(64)}`;
    mocks.generations.set("native-agents", newerGeneration);
    const second = reconcileConfigMutation(projectRoot, ["native-agents"], { kilnHome });

    // The second canonical-path mutation cannot enter the shared projection
    // while the first reconciliation still owns this target.
    await Promise.resolve();
    expect(callCount).toBe(1);
    releaseFirst();

    const [firstEffect] = await first;
    const [secondEffect] = await second;
    expect(firstEffect).toMatchObject({
      target: "native-agents",
      status: "skipped",
      summary: "native-agents reconciliation was superseded by a newer canonical revision.",
    });
    expect(secondEffect).toMatchObject({ target: "native-agents", status: "ok", generation: newerGeneration });
    expect(publishedGeneration).toBe(newerGeneration);
    expect(callCount).toBe(3);
  });
});
