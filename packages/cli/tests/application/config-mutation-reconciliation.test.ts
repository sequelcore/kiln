import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileConfigMutation } from "../../src/application/config-mutation-reconciliation.js";

const mocks = vi.hoisted(() => ({
  globalConfig: { version: "4", modelGateway: { enabled: true } } as Record<string, unknown> | null,
  routeAuthority: { executionCatalog: { routes: [{ id: "terra" }] } } as unknown,
  syncPermissions: vi.fn(),
  syncAgents: vi.fn(),
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
vi.mock("../../src/application/repo-shim-projection.js", () => ({ writeRepoShimProjections: vi.fn() }));
vi.mock("../../src/config/communication-policy.js", () => ({ configuredCommunicationCandidates: vi.fn() }));
vi.mock("../../src/kiln-yaml.js", () => ({ readKilnYaml: vi.fn() }));
vi.mock("../../src/application/config-reconciliation-generation.js", () => ({
  captureCanonicalReconciliationGeneration: (_projectPath: string, target: string) => mocks.generations.get(target) ?? `sha256:${"a".repeat(64)}`,
}));

describe("configuration mutation reconciliation", () => {
  beforeEach(() => {
    mocks.globalConfig = { version: "4", modelGateway: { enabled: true } };
    mocks.routeAuthority = { executionCatalog: { routes: [{ id: "terra" }] } };
    mocks.syncPermissions.mockReset().mockResolvedValue({ errors: [], outcomes: [] });
    mocks.syncAgents.mockReset().mockResolvedValue({ errors: [], synced: 1 });
    mocks.loadConfigWithAuthority.mockReset().mockResolvedValue({ kilnYaml: { version: "1" }, globalConfig: mocks.globalConfig });
    mocks.generations.clear();
  });

  it("converges native permission projections from committed global intent", async () => {
    const [effect] = await reconcileConfigMutation("C:/fixture/project", ["native-permissions"]);

    expect(mocks.syncPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1" }),
      "C:/fixture/project",
      { force: true, modelGateway: { enabled: true } },
    );
    expect(effect).toMatchObject({ target: "native-permissions", status: "ok", generation: `sha256:${"a".repeat(64)}` });
  });

  it("reports native projection errors as reconciliation failure after commit", async () => {
    mocks.syncPermissions.mockResolvedValue({ errors: ["Codex: managed field drift"], outcomes: [] });

    const [effect] = await reconcileConfigMutation("C:/fixture/project", ["native-permissions"]);

    expect(effect).toMatchObject({
      target: "native-permissions",
      status: "failed",
      errors: ["Codex: managed field drift"],
    });
  });

  it("reads the committed target intent with its exact evidence before reporting routes reconciled", async () => {
    const [effect] = await reconcileConfigMutation("C:/fixture/project", ["execution-routes"]);

    expect(effect).toEqual({
      target: "execution-routes",
      status: "ok",
      summary: "1 execution routes verified from canonical intent and evidence.",
      errors: [],
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

    const first = reconcileConfigMutation("C:/fixture/project", ["native-agents"]);
    await firstDidStart;
    const newerGeneration = `sha256:${"b".repeat(64)}`;
    mocks.generations.set("native-agents", newerGeneration);
    const second = reconcileConfigMutation("C:/fixture/project", ["native-agents"]);

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
