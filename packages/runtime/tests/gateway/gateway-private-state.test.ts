import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startGateway } from "../../src/gateway/gateway-server.js";
import * as gatewayPrivateState from "../../src/gateway/gateway-private-state.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("gateway private state", () => {
  it("derives opaque mutable state below the operator Kiln home", () => {
    const root = fixture();
    const configPath = join(root, "gateway.yaml");
    writeFileSync(configPath, "port: 4810\napps: []\n", "utf8");
    const state = gatewayPrivateState.resolveGatewayPrivateState(configPath, { kilnHome: join(root, "operator-kiln") });

    expect(state.gatewayStateId).toMatch(/^kgs_[a-f0-9]{64}$/u);
    expect(state.root).toBe(join(root, "operator-kiln", "gateway", "configurations", state.gatewayStateId));
    expect(state.root).not.toContain(join(root, ".kiln"));
    expect(state.secretsPath).toBe(join(state.root, "secrets.json"));
    expect(state.modelGatewayDatabasePath).toBe(join(state.root, "model-gateway.sqlite"));
  });

  it("accepts an exact private project-state root from CLI composition", () => {
    const root = fixture();
    const configPath = join(root, "gateway.yaml");
    const privateStateRoot = join(root, "operator-kiln", "projects", "krp_test", "runtime", "app-gateway");
    writeFileSync(configPath, "port: 4810\napps: []\n", "utf8");

    expect(gatewayPrivateState.resolveGatewayPrivateState(configPath, { privateStateRoot }).root).toBe(privateStateRoot);
  });

  it("passes an explicit Kiln home to startup private-state resolution when XDG differs", async () => {
    const root = fixture();
    const configPath = join(root, "gateway.yaml");
    const kilnHome = join(root, "explicit-kiln");
    const ambientXdg = join(root, "ambient-xdg");
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = ambientXdg;
    const resolveSpy = vi.spyOn(gatewayPrivateState, "resolveGatewayPrivateState");

    try {
      writeFileSync(join(root, "app.yaml"), "name: test-app\n", "utf8");
      writeFileSync(configPath, "port: 4810\napps:\n  - name: test-app\n    config: app.yaml\n    channels:\n      - type: api\n        path: /api/test-app\n", "utf8");
      await expect(startGateway(configPath, {
        kilnHome,
        supervision: {
          identity: { port: 9999 } as never,
          controlToken: "synthetic-control-token",
        },
      })).rejects.toMatchObject({ code: "CONFIG_INVALID" });

      expect(resolveSpy).toHaveBeenCalledWith(configPath, { kilnHome });
      const resolvedState = resolveSpy.mock.results[resolveSpy.mock.results.length - 1]?.value;
      expect(resolvedState).toMatchObject({
        root: expect.stringContaining(join(kilnHome, "gateway", "configurations")),
      });
      expect((resolvedState as { root: string }).root).not.toContain(ambientXdg);
    } finally {
      resolveSpy.mockRestore();
      if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
  });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-gateway-state-"));
  fixtures.push(root);
  return root;
}
