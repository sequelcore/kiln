import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGlobalConfig } from "../../src/config/global-config.js";
import { createNativeHarnessManagedJobApplicationComposition } from "../../src/application/codex-app-managed-jobs.js";
import { economicConfig } from "../config/managed-economic-policy-config.test.js";

/**
 * Regression proof for #56 revised S1: the project-local native-harness
 * `kiln-control-plane` MCP composition must not lose global `modelGateway`
 * authority when it derives its managed-route config from
 * `readConfigStatusSnapshot().effectiveConfig` (a project/status
 * projection). Unlike `codex-app-managed-jobs.test.ts`, this file does not
 * mock `config-status.js` or `global-config.js`: it drives the real
 * production `readConfigStatusSnapshot()` + `readGlobalConfig()` reads
 * against real fixture files on disk, through the real composition
 * boundary (`createNativeHarnessManagedJobApplicationComposition`). A fake
 * `effectiveConfig` mock (as the existing sibling test uses) can assert
 * whatever shape it likes, including a `modelGateway` field that
 * `KilnYaml`/`globalToKilnYaml` never actually produce -- which is exactly
 * how the original defect went uncaught.
 */
describe("native-harness managed-route runtime config authority (#56 S1)", () => {
  const tempDirs: string[] = [];
  const isolatedEnvKeys = ["XDG_CONFIG_HOME", "HOME", "USERPROFILE"] as const;
  const originalEnv: Partial<Record<typeof isolatedEnvKeys[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of isolatedEnvKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Isolates both the global-config path (`XDG_CONFIG_HOME`, read by
   * `readGlobalConfig()`) and `os.homedir()` (`HOME`/`USERPROFILE`, read by
   * `loadAgentDefinitions()` and the skill/instruction-shim projections inside
   * `readConfigStatusSnapshot()`). Without the latter, this test would pick up
   * the real operator's `~/.kiln/agents` definitions and become
   * machine-dependent.
   */
  function useIsolatedGlobalConfigHome(): void {
    for (const key of isolatedEnvKeys) {
      originalEnv[key] = process.env[key];
    }
    const globalHome = mkdtempSync(join(tmpdir(), "kiln-global-config-"));
    tempDirs.push(globalHome);
    process.env.XDG_CONFIG_HOME = globalHome;
    process.env.HOME = globalHome;
    process.env.USERPROFILE = globalHome;
  }

  function createProjectRoot(kilnYamlContents: string): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-native-harness-runtime-config-"));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(join(projectRoot, ".kiln", "kiln.yaml"), kilnYamlContents, "utf8");
    return projectRoot;
  }

  it("constructs the managed-job composition from canonical schema-v2 config with a valid global modelGateway", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    const projectRoot = createProjectRoot('version: "1"\n');

    const composition = await createNativeHarnessManagedJobApplicationComposition({
      harness: "codex",
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    });
    try {
      expect(composition.application).toBeDefined();
    } finally {
      composition.close();
    }
  });

  it("ignores a modelGateway key a project kiln.yaml is not authorized to declare", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    // `KilnYaml` has no `modelGateway` field; this simulates an operator (or a
    // regression) hand-editing project kiln.yaml with an out-of-schema key that
    // would crash `ConfiguredManagedAccountRuntime` if it were ever used as the
    // gateway config. `mergeKilnYaml` already drops unknown override fields, and
    // the native-harness loader always sources `modelGateway` from the global
    // config directly, so composition must succeed using the valid global value.
    const projectRoot = createProjectRoot([
      'version: "1"',
      "modelGateway: not-a-gateway",
    ].join("\n"));

    const composition = await createNativeHarnessManagedJobApplicationComposition({
      harness: "codex",
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    });
    try {
      expect(composition.application).toBeDefined();
    } finally {
      composition.close();
    }
  });

  it("stays fail-closed when a project-declared runtime-selected route has no reachable global modelGateway", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig({ version: "1" });
    const projectRoot = createProjectRoot([
      'version: "1"',
      "managedAgents:",
      "  schemaVersion: 2",
      "  routes:",
      "    - id: project-declared-route",
      "      kind: direct",
      "      provider: codex-oauth",
      "      model: gpt-5.6-terra",
      "      credentials:",
      "        mode: runtime-selected",
      "        accountPolicyId: unresolvable-policy",
    ].join("\n"));

    await expect(createNativeHarnessManagedJobApplicationComposition({
      harness: "codex",
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    })).rejects.toThrow("Managed account or economic routes require modelGateway configuration.");
  });
});
