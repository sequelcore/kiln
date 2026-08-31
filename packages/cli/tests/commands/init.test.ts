import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { DomainRegistry } from "@kilnai/core/domain";
import { defaultGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import { proposeConfigMutation } from "../../src/application/config-mutation-authority.js";
import { readProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { resolveTrustedWorkspace } from "../../src/application/trusted-workspace-resolution.js";
import { initCommand } from "../../src/commands/init.js";
import type { KilnAppConfig } from "../../src/config.js";

const readlineState = vi.hoisted(() => ({ answers: [] as string[], questions: [] as string[] }));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (question: string, callback: (answer: string) => void) => {
      readlineState.questions.push(question);
      callback(readlineState.answers.shift() ?? "n");
    },
    close: vi.fn(),
  }),
}));

const target = {
  id: "codex-default",
  kind: "direct" as const,
  label: "Codex default",
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
};

function globalConfig(): KilnGlobalConfig {
  return {
    ...defaultGlobalConfig(),
    targetCatalog: {
      evidenceRevision: `sha256:${"a".repeat(64)}`,
      accounts: [],
      accountPolicies: [],
      targets: [target] as never,
    },
    targetRouting: { defaultTargetId: target.id },
  };
}

const appConfig: KilnAppConfig = {
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
};

describe("initCommand", () => {
  let projectPath: string;
  let globalHome: string;
  let previousXdgConfigHome: string | undefined;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let originalTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-init-v7-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-init-v7-global-"));
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    writeFileSync(join(globalHome, "kiln", "config.yaml"), [
      "version: '7'",
      "permissions:",
      "  approval: on-request",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    readlineState.answers = [];
    readlineState.questions = [];
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    originalTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  });

  afterEach(() => {
    if (originalTTY) Object.defineProperty(process.stdin, "isTTY", originalTTY);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    consoleLog.mockRestore();
    consoleError.mockRestore();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  });

  it("adopts only the minimal project document and no legacy templates", async () => {
    const result = await initCommand(appConfig, projectPath, {
      interactive: false,
      dependencies: {
        readGlobalConfig: globalConfig,
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result?.version).toBe("1");
    const binding = resolveProjectStateBinding(projectPath);
    expect(parse(readFileSync(binding.configPath, "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });
    expect(readProjectAdoption(binding).status).toBe("adopted");
    const trusted = resolveTrustedWorkspace(
      { cwd: () => projectPath },
      {
        userHome: tmpdir(),
        kilnHome: join(globalHome, "kiln"),
        globalConfigPath: join(globalHome, "kiln", "config.yaml"),
      },
    );
    if (trusted.status === "rejected") throw new Error(`Freshly initialized workspace was rejected: ${trusted.reason}`);
    expect(trusted.status).toBe("resolved");
    expect(existsSync(join(projectPath, ".kiln"))).toBe(false);
  });

  it("reruns idempotently without proposing another project adoption", async () => {
    const propose = vi.fn(proposeConfigMutation);
    const dependencies = {
      readGlobalConfig: globalConfig,
      readTargetAuthority: () => ({ current: true }),
      proposeMutation: propose,
    };

    await initCommand(appConfig, projectPath, { interactive: false, dependencies });
    const second = await initCommand(appConfig, projectPath, { interactive: false, dependencies });

    expect(second?.version).toBe("1");
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it("cancels before apply and writes nothing", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    readlineState.answers = ["y", "n"];

    const result = await initCommand(appConfig, projectPath, {
      dependencies: {
        readGlobalConfig: globalConfig,
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result).toBeNull();
    expect(existsSync(resolveProjectStateBinding(projectPath).configPath)).toBe(false);
    expect(consoleLog.mock.calls.flat().join("\n")).toContain("cancelled");
    expect(readlineState.questions.some((question) => question.startsWith("Apply onboarding"))).toBe(true);
  });

  it("treats a declined safe posture as cancellation before any write", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    readlineState.answers = ["n"];

    const result = await initCommand(appConfig, projectPath, {
      dependencies: {
        readGlobalConfig: globalConfig,
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result).toBeNull();
    expect(existsSync(resolveProjectStateBinding(projectPath).configPath)).toBe(false);
    expect(consoleLog.mock.calls.flat().join("\n")).toContain("cancelled");
    expect(readlineState.questions.some((question) => question.startsWith("Apply onboarding"))).toBe(false);
  });

  it("treats declined target approval as cancellation before any write", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    readlineState.answers = ["y", "n", "y"];
    const withoutDefault = { ...globalConfig(), targetRouting: undefined };

    const result = await initCommand(appConfig, projectPath, {
      dependencies: {
        readGlobalConfig: () => withoutDefault,
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result).toBeNull();
    expect(existsSync(resolveProjectStateBinding(projectPath).configPath)).toBe(false);
    expect(consoleLog.mock.calls.flat().join("\n")).toContain("cancelled");
  });

  it("does not write when the global target is unavailable", async () => {
    const result = await initCommand(appConfig, projectPath, {
      interactive: false,
      dependencies: {
        readGlobalConfig: () => ({ version: "7" }),
        readTargetAuthority: () => undefined,
      },
    });

    expect(result).toBeNull();
    expect(existsSync(resolveProjectStateBinding(projectPath).configPath)).toBe(false);
    expect(consoleError.mock.calls.flat().join("\n")).toContain("target");
  });

  it("requires an explicit target in non-interactive mode when no default exists", async () => {
    const result = await initCommand(appConfig, projectPath, {
      interactive: false,
      approve: true,
      dependencies: {
        readGlobalConfig: () => ({ ...globalConfig(), targetRouting: undefined }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result).toBeNull();
    expect(existsSync(resolveProjectStateBinding(projectPath).configPath)).toBe(false);
    expect(consoleError.mock.calls.flat().join("\n")).toContain("Select an admitted direct target");
  });
});
