import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevLaunchPlan } from "../../src/commands/dev.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

describe("resolveDevLaunchPlan", () => {
  const root = join("workspace", "project");
  const gatewayPath = join(root, "gateway.yaml");
  const appPath = join(root, "app.yaml");

  it("requires a canonical gateway configuration", () => {
    expect(resolveDevLaunchPlan(root, {}, () => false)).toEqual({
      ok: false,
      message: "No gateway configuration found. Create gateway.yaml or pass --config <path>.",
    });
  });

  it("launches the canonical gateway and watches its bound project configuration", () => {
    const plan = resolveDevLaunchPlan(
      root,
      {},
      (path) => path === gatewayPath || path === appPath,
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
      (path) => path === gatewayPath,
    );

    expect(plan).toMatchObject({
      ok: true,
      gatewayPath,
      port: 4900,
      openUrl: "http://localhost:4900/gui/",
    });
  });

  it("plans a nested invocation against the canonical project root", () => {
    const canonicalRoot = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
    const nestedCwd = join(canonicalRoot, "packages", "cli", "src");
    const resolved = resolveProjectRoot({ cwd: nestedCwd });
    const canonicalGatewayPath = join(canonicalRoot, "gateway.yaml");

    expect(resolved.rootPath).toBe(canonicalRoot);
    expect(resolveDevLaunchPlan(resolved.rootPath, {}, (path) => path === canonicalGatewayPath)).toMatchObject({
      ok: true,
      gatewayPath: canonicalGatewayPath,
    });
  });
});
