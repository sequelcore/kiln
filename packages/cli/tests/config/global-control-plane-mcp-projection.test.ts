import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveGlobalControlPlaneMcpProjectionPaths,
  syncGlobalControlPlaneMcpProjections,
} from "../../src/config/global-control-plane-mcp-projection.js";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-global-control-plane-"));
  roots.push(root);
  return root;
}

function syntheticLaunch(root: string) {
  return {
    executable: join(root, "runtime", "bun"),
    entrypoint: join(root, "kiln", "packages", "cli", "dist", "index.js"),
  } as const;
}

describe("global control-plane MCP projection", () => {
  it("serializes concurrent harness subsets without losing install state", async () => {
    const userHome = temporaryRoot();
    const launch = syntheticLaunch(userHome);
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    const lockPath = join(paths.installStateDir, "global-native-projections.lock");
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ token: "external-test-owner" }));

    let codexSettled = false;
    let claudeSettled = false;
    const codex = syncGlobalControlPlaneMcpProjections({
      operation: "install", userHome, launch, harnesses: ["codex"], lifecycleLockTimeoutMs: 1_000, lifecycleLockRetryMs: 2,
    }).finally(() => { codexSettled = true; });
    const claude = syncGlobalControlPlaneMcpProjections({
      operation: "install", userHome, launch, harnesses: ["claude"], lifecycleLockTimeoutMs: 1_000, lifecycleLockRetryMs: 2,
    }).finally(() => { claudeSettled = true; });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(codexSettled).toBe(false);
    expect(claudeSettled).toBe(false);
    rmSync(lockPath, { recursive: true });
    await Promise.all([codex, claude]);

    const state = JSON.parse(readFileSync(join(paths.installStateDir, "install-state.json"), "utf8"));
    expect(Object.keys(state.targets).sort()).toEqual([
      "global-control-plane-mcp:claude",
      "global-control-plane-mcp:codex",
    ]);
    expect(parseToml(readFileSync(paths.codex, "utf8"))).toMatchObject({
      mcp_servers: { "kiln-control-plane": {
        command: launch.executable,
        args: [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "codex"],
      } },
    });
    expect(JSON.parse(readFileSync(paths.claude, "utf8"))).toMatchObject({
      mcpServers: { "kiln-control-plane": {
        command: launch.executable,
        args: [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "claude"],
      } },
    });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("fails closed without stealing an abandoned lifecycle lock", async () => {
    const userHome = temporaryRoot();
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    const lockPath = join(paths.installStateDir, "global-native-projections.lock");
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ token: "abandoned-owner", pid: 1 }));

    await expect(syncGlobalControlPlaneMcpProjections({
      operation: "install", userHome, harnesses: ["codex"], lifecycleLockTimeoutMs: 15, lifecycleLockRetryMs: 2,
    })).rejects.toThrow(/projection lock.*remove.*confirming/i);

    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(paths.codex)).toBe(false);
    expect(existsSync(join(paths.installStateDir, "install-state.json"))).toBe(false);
  });

  it("uses the documented user-wide paths and exact project-neutral commands for all harnesses", async () => {
    const userHome = temporaryRoot();
    const launch = syntheticLaunch(userHome);
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);

    expect(paths).toMatchObject({
      codex: join(userHome, ".codex", "config.toml"),
      claude: join(userHome, ".claude.json"),
      opencode: join(userHome, ".config", "opencode", "opencode.json"),
      installStateDir: join(userHome, ".kiln", "runtime", "native-projections"),
    });
    mkdirSync(join(userHome, ".codex"), { recursive: true });
    mkdirSync(join(userHome, ".config", "opencode"), { recursive: true });
    writeFileSync(paths.codex, 'model = "keep"\n', "utf8");
    writeFileSync(paths.claude, JSON.stringify({ theme: "keep" }), "utf8");
    writeFileSync(paths.opencode, JSON.stringify({ provider: { keep: true } }), "utf8");

    const result = await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, launch });

    expect(result.targets.every((target) => target.status === "current" && target.changed)).toBe(true);
    expect(parseToml(readFileSync(paths.codex, "utf8"))).toMatchObject({
      model: "keep",
      mcp_servers: { "kiln-control-plane": {
        command: launch.executable,
        args: [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "codex"],
        enabled: true,
      } },
    });
    expect(JSON.parse(readFileSync(paths.claude, "utf8"))).toEqual({
      theme: "keep",
      mcpServers: { "kiln-control-plane": {
        type: "stdio", command: launch.executable,
        args: [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "claude"],
      } },
    });
    expect(JSON.parse(readFileSync(paths.opencode, "utf8"))).toEqual({
      provider: { keep: true },
      mcp: { "kiln-control-plane": {
        type: "local",
        command: [launch.executable, launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "opencode"],
        enabled: true,
      } },
    });
    expect(JSON.stringify(result)).not.toContain("project-root");
  });

  it("reports current status, fails closed on drift, and repairs only when forced", async () => {
    const userHome = temporaryRoot();
    const launch = syntheticLaunch(userHome);
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, launch, harnesses: ["codex"] });
    const current = await syncGlobalControlPlaneMcpProjections({ operation: "status", userHome, launch, harnesses: ["codex"] });
    expect(current.targets).toEqual([expect.objectContaining({ status: "current", changed: false })]);

    writeFileSync(paths.codex, readFileSync(paths.codex, "utf8").replace(`command = ${JSON.stringify(launch.executable)}`, 'command = "tampered"'));
    const blocked = await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, launch, harnesses: ["codex"] });
    expect(blocked.targets).toEqual([expect.objectContaining({ status: "drifted", changed: false })]);
    expect(readFileSync(paths.codex, "utf8")).toContain('command = "tampered"');

    const repaired = await syncGlobalControlPlaneMcpProjections({
      operation: "install", userHome, launch, harnesses: ["codex"], force: true, now: "2026-08-08T00:00:00.000Z",
    });
    expect(repaired.targets).toEqual([expect.objectContaining({ status: "current", changed: true })]);
    expect(parseToml(readFileSync(paths.codex, "utf8"))).toMatchObject({
      mcp_servers: { "kiln-control-plane": {
        command: launch.executable,
        args: [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", "codex"],
      } },
    });
    const backupDir = join(paths.installStateDir, "backups", "global-control-plane-mcp_codex");
    expect(readdirSync(backupDir)).toEqual(["2026-08-08T00-00-00-000Z-config.toml.bak"]);
    expect(readFileSync(join(backupDir, readdirSync(backupDir)[0]!), "utf8")).toContain('command = "tampered"');
    if (process.platform !== "win32") {
      expect(statSync(paths.codex).mode & 0o777).toBe(0o600);
      expect(statSync(join(backupDir, readdirSync(backupDir)[0]!)).mode & 0o777).toBe(0o600);
    }
  });

  it("preserves unmanaged fields on uninstall and refuses an unmanaged identity collision", async () => {
    const userHome = temporaryRoot();
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    mkdirSync(join(userHome, ".config", "opencode"), { recursive: true });
    writeFileSync(paths.opencode, JSON.stringify({ theme: "keep", mcp: { other: { type: "local", command: ["keep"] } } }));
    await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, harnesses: ["opencode"] });
    const removed = await syncGlobalControlPlaneMcpProjections({ operation: "uninstall", userHome, harnesses: ["opencode"] });
    expect(removed.targets).toEqual([expect.objectContaining({ status: "uninstalled", changed: true })]);
    expect(JSON.parse(readFileSync(paths.opencode, "utf8"))).toEqual({
      theme: "keep", mcp: { other: { type: "local", command: ["keep"] } },
    });

    writeFileSync(paths.opencode, JSON.stringify({ mcp: { "kiln-control-plane": { type: "local", command: ["someone-else"] } } }));
    const collision = await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, harnesses: ["opencode"] });
    expect(collision.targets).toEqual([expect.objectContaining({ status: "incompatible", changed: false, reason: expect.stringContaining("unmanaged") })]);
    expect(JSON.parse(readFileSync(paths.opencode, "utf8"))).toEqual({ mcp: { "kiln-control-plane": { type: "local", command: ["someone-else"] } } });
  });

  it("does not create files for missing uninstalled projections", async () => {
    const userHome = temporaryRoot();
    const result = await syncGlobalControlPlaneMcpProjections({ operation: "uninstall", userHome });
    expect(result.targets.every((target) => target.status === "uninstalled" && !target.changed)).toBe(true);
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    expect(existsSync(paths.codex)).toBe(false);
    expect(existsSync(paths.claude)).toBe(false);
    expect(existsSync(paths.opencode)).toBe(false);
  });

  it("refuses install state that claims unrelated native fields", async () => {
    const userHome = temporaryRoot();
    const launch = syntheticLaunch(userHome);
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);
    await syncGlobalControlPlaneMcpProjections({ operation: "install", userHome, launch, harnesses: ["claude"] });
    const statePath = join(paths.installStateDir, "install-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.targets["global-control-plane-mcp:claude"].managedFields.push("/theme");
    state.targets["global-control-plane-mcp:claude"].managedFieldHashes["/theme"] = "synthetic";
    writeFileSync(statePath, JSON.stringify(state));

    const result = await syncGlobalControlPlaneMcpProjections({ operation: "uninstall", userHome, harnesses: ["claude"], force: true });

    expect(result.targets).toEqual([expect.objectContaining({ status: "incompatible", changed: false })]);
    expect(JSON.parse(readFileSync(paths.claude, "utf8")).mcpServers["kiln-control-plane"]).toBeDefined();
  });

  it("rejects unsafe or ambiguous launch descriptors before writing native config", async () => {
    const userHome = temporaryRoot();
    const paths = resolveGlobalControlPlaneMcpProjectionPaths(userHome);

    await expect(syncGlobalControlPlaneMcpProjections({
      operation: "install",
      userHome,
      harnesses: ["codex"],
      launch: { executable: "bun", entrypoint: join(userHome, "dist", "index.js") },
    })).rejects.toThrow(/executable.*absolute/i);
    await expect(syncGlobalControlPlaneMcpProjections({
      operation: "install",
      userHome,
      harnesses: ["codex"],
      launch: { executable: join(userHome, "bun"), entrypoint: `${join(userHome, "dist", "index.js")}\n--project-root` },
    })).rejects.toThrow(/entrypoint.*control characters/i);

    expect(existsSync(paths.codex)).toBe(false);
  });
});
