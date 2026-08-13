import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevLaunchPlan } from "../../src/commands/dev.js";

describe("resolveDevLaunchPlan", () => {
  const root = join("workspace", "project");
  const kilnDir = join(root, ".kiln");
  const gatewayPath = join(kilnDir, "gateway.yaml");
  const appPath = join(kilnDir, "app.yaml");

  it("requires an initialized project with a gateway configuration", () => {
    expect(resolveDevLaunchPlan(root, {}, () => false)).toEqual({
      ok: false,
      message: "Not initialized. Run 'kiln init' first.",
    });

    expect(resolveDevLaunchPlan(root, {}, (path) => path === kilnDir)).toEqual({
      ok: false,
      message: "No gateway configuration found. Run 'kiln init' or pass --config <path>.",
    });
  });

  it("launches the canonical gateway and watches its bound project configuration", () => {
    const plan = resolveDevLaunchPlan(
      root,
      {},
      (path) => path === kilnDir || path === gatewayPath || path === appPath,
    );

    expect(plan).toEqual({
      ok: true,
      gatewayPath,
      port: 4800,
      watchPaths: [gatewayPath, appPath],
    });
  });

  it("opens the canonical GUI instead of a separate playground", () => {
    const plan = resolveDevLaunchPlan(
      root,
      { port: 4900, open: true },
      (path) => path === kilnDir || path === gatewayPath,
    );

    expect(plan).toMatchObject({
      ok: true,
      gatewayPath,
      port: 4900,
      openUrl: "http://localhost:4900/gui/",
    });
  });
});
