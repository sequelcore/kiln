import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileConfigMutation } from "../../src/application/config-mutation-reconciliation.js";

const mocks = vi.hoisted(() => ({
  globalConfig: { version: "4", modelGateway: { enabled: true } } as Record<string, unknown> | null,
  routeAuthority: { executionCatalog: { routes: [{ id: "terra" }] } } as unknown,
  syncPermissions: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  globalToKilnYaml: (config: unknown) => ({ version: "1", source: config }),
  loadKilnConfig: vi.fn(),
  loadKilnConfigWithGlobalAuthority: vi.fn(),
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: () => mocks.globalConfig,
  readGlobalExecutionTargetAuthority: () => mocks.routeAuthority,
}));

vi.mock("../../src/config/native-permission-projection.js", () => ({
  syncNativePermissionProjections: mocks.syncPermissions,
}));

vi.mock("../../src/config/native-agent-projection.js", () => ({ syncNativeAgentProjections: vi.fn() }));
vi.mock("../../src/config/native-skill-projection.js", () => ({ syncNativeSkillProjections: vi.fn() }));
vi.mock("../../src/application/repo-shim-projection.js", () => ({ writeRepoShimProjections: vi.fn() }));
vi.mock("../../src/config/communication-policy.js", () => ({ configuredCommunicationCandidates: vi.fn() }));
vi.mock("../../src/kiln-yaml.js", () => ({ readKilnYaml: vi.fn() }));

describe("configuration mutation reconciliation", () => {
  beforeEach(() => {
    mocks.globalConfig = { version: "4", modelGateway: { enabled: true } };
    mocks.routeAuthority = { executionCatalog: { routes: [{ id: "terra" }] } };
    mocks.syncPermissions.mockReset().mockResolvedValue({ errors: [], outcomes: [] });
  });

  it("converges native permission projections from committed global intent", async () => {
    const [effect] = await reconcileConfigMutation("C:/fixture/project", ["native-permissions"]);

    expect(mocks.syncPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1" }),
      "C:/fixture/project",
      { force: true, modelGateway: { enabled: true } },
    );
    expect(effect).toMatchObject({ target: "native-permissions", status: "ok" });
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
    });
  });
});
