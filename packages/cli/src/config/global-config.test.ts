import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  chmodSync: vi.fn(),
  fsyncSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test-user"),
}));

import { KilnYamlError } from "../kiln-yaml.js";
import {
  commitGlobalConfigBytes,
  defaultGlobalConfig,
  type GlobalConfigMutationError,
  readGlobalConfig,
  resolveGlobalConfigPath,
  resolveKilnHomePath,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
  resolveGlobalModelGatewayConfig,
  resolveGlobalUiAppearance,
} from "./global-config.js";

const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const openSyncMock = openSync as unknown as ReturnType<typeof vi.fn>;
const closeSyncMock = closeSync as unknown as ReturnType<typeof vi.fn>;
const renameSyncMock = renameSync as unknown as ReturnType<typeof vi.fn>;
const rmSyncMock = rmSync as unknown as ReturnType<typeof vi.fn>;
const statSyncMock = statSync as unknown as ReturnType<typeof vi.fn>;
const chmodSyncMock = chmodSync as unknown as ReturnType<typeof vi.fn>;
const fsyncSyncMock = fsyncSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = homedir as unknown as ReturnType<typeof vi.fn>;
const EXECUTABLE_DIGEST = `sha256:${"a".repeat(64)}`;

function revisionOf(raw: string | null): string {
  if (raw === null) return "absent";
  return `sha256:${createHash("sha256")
    .update(raw ?? "")
    .digest("hex")}`;
}

function commitGlobalConfigForTest(
  input: {
    readonly content?: string;
    readonly currentRaw?: string | null;
    readonly invalidCurrent?: "backup-and-replace";
  } = {},
) {
  return commitGlobalConfigBytes({
    content: input.content ?? 'version: "7"\n',
    expectedRevision: revisionOf(input.currentRaw === undefined ? 'version: "7"\n' : input.currentRaw),
    ...(input.invalidCurrent === undefined ? {} : { invalidCurrent: input.invalidCurrent }),
  });
}

const V7_DIRECT_TARGET_INTENT_YAML =
  "    - { id: codex-terra, kind: direct, label: Codex Terra, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, accountPolicyId: codex-policy, economics: { authBillingChannel: subscription, executionMode: direct, serviceTier: default, fallbackPosture: disabled, overagePosture: disabled, executionEnvelope: { limits: [] } } }";
const V7_HARNESS_TARGET_INTENT_YAML =
  "    - { id: claude-cli, kind: harness, label: Claude CLI, providerId: claude, providerModelId: claude-opus-4-6, dataClassification: internal }";

function canonicalV7GlobalYaml(): string {
  return [
    'version: "7"',
    "targetCatalog:",
    `  evidenceRevision: sha256:${"a".repeat(64)}`,
    "  accounts: [{ id: codex-account, providerId: codex-oauth, credentialId: codex-credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { creditPosture: disabled, overagePosture: disabled } }]",
    "  accountPolicies: [{ id: codex-policy, accountIds: [codex-account], strategy: economic-least-pressure }]",
    "  targets:",
    V7_DIRECT_TARGET_INTENT_YAML,
    V7_HARNESS_TARGET_INTENT_YAML,
    "authorityProfiles:",
    "  - { id: readonly-scout, access: read-only, workingDirectory: project }",
    "targetRouting: { defaultTargetId: codex-terra }",
    "managedAgents:",
    "  defaultAuthorityProfileId: readonly-scout",
    "  intents:",
    "    - { id: reviewer, purpose: Review the requested change, authorityProfileId: readonly-scout, target: { mode: explicit, targetId: codex-terra }, model: { mode: explicit, modelId: gpt-5.6-terra }, paidUsage: ask-before-spend }",
    "ui:",
    "  targetSelection: { targetId: codex-terra, accountOverrideId: codex-account }",
  ].join("\n");
}

describe("global-config", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    openSyncMock.mockReset();
    closeSyncMock.mockReset();
    renameSyncMock.mockReset();
    rmSyncMock.mockReset();
    statSyncMock.mockReset();
    chmodSyncMock.mockReset();
    fsyncSyncMock.mockReset();
    openSyncMock.mockReturnValue(7);
    homedirMock.mockReset();
    homedirMock.mockReturnValue("/home/test-user");
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    vi.restoreAllMocks();
  });

  it("resolveGlobalConfigPath() returns ~/.kiln/config.yaml when XDG_CONFIG_HOME is not set", () => {
    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/home/test-user", ".kiln", "config.yaml"));
  });

  it("resolveGlobalConfigPath() returns XDG_CONFIG_HOME/kiln/config.yaml when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";

    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/tmp/xdg", "kiln", "config.yaml"));
  });

  it("resolveGlobalConfigPath() preserves the explicit-home precedence", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";

    const path = resolveGlobalConfigPath("  /tmp/explicit/../kiln-home  ");

    expect(path).toBe(join("/tmp/explicit/../kiln-home", "config.yaml"));
    expect(resolveKilnHomePath("  /tmp/explicit/../kiln-home  ")).toBe("/tmp/explicit/../kiln-home");
  });

  it("readGlobalConfig() returns null when file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const config = readGlobalConfig();

    expect(config).toBeNull();
  });

  it("readGlobalConfig() parses and returns valid config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts:",
        "    - { id: codex-primary, providerId: codex-oauth, credentialId: codex-primary, maxConcurrency: 2, reservedAffinitySlots: 1, economics: { creditPosture: disabled, overagePosture: disabled } }",
        "  accountPolicies:",
        "    - { id: codex-automatic, accountIds: [codex-primary], strategy: economic-least-pressure }",
        "  targets:",
        "    - id: terra",
        "      kind: direct",
        "      label: Terra",
        "      providerId: codex-oauth",
        "      providerModelId: codex/gpt-5.6-terra",
        "      dataClassification: internal",
        "      accountPolicyId: codex-automatic",
        "      economics: { authBillingChannel: subscription, executionMode: direct, serviceTier: default, fallbackPosture: disabled, overagePosture: disabled, executionEnvelope: { limits: [] } }",
        "targetRouting:",
        "  defaultTargetId: terra",
      ].join("\n"),
    );

    const config = readGlobalConfig();

    expect(config).toEqual({
      version: "7",
      targetCatalog: {
        evidenceRevision: `sha256:${"a".repeat(64)}`,
        accounts: [
          {
            id: "codex-primary",
            providerId: "codex-oauth",
            credentialId: "codex-primary",
            maxConcurrency: 2,
            reservedAffinitySlots: 1,
            economics: {
              creditPosture: "disabled",
              overagePosture: "disabled",
            },
          },
        ],
        accountPolicies: [
          {
            id: "codex-automatic",
            accountIds: ["codex-primary"],
            strategy: "economic-least-pressure",
          },
        ],
        targets: [
          {
            id: "terra",
            kind: "direct",
            label: "Terra",
            providerId: "codex-oauth",
            providerModelId: "codex/gpt-5.6-terra",
            dataClassification: "internal",
            accountPolicyId: "codex-automatic",
            economics: {
              authBillingChannel: "subscription",
              executionMode: "direct",
              serviceTier: "default",
              fallbackPosture: "disabled",
              overagePosture: "disabled",
              executionEnvelope: { limits: [] },
            },
          },
        ],
      },
      targetRouting: {
        defaultTargetId: "terra",
      },
    });
  });

  it("readGlobalConfig() accepts the operator-owned Dafny verifier declaration", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "verification:",
        "  formal:",
        "    dafny:",
        "      executable: /opt/dafny/dafny",
        "      installationRoot: /opt/dafny",
        "      expectedVersion: 4.11.0",
        `      expectedInstallationDigest: ${EXECUTABLE_DIGEST}`,
      ].join("\n"),
    );

    expect(readGlobalConfig()?.verification).toEqual({
      formal: {
        dafny: {
          executable: "/opt/dafny/dafny",
          installationRoot: "/opt/dafny",
          expectedVersion: "4.11.0",
          expectedInstallationDigest: EXECUTABLE_DIGEST,
        },
      },
    });
  });

  it("readGlobalConfig() accepts the operator-owned formal screening inputs", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "verification:",
        "  formal:",
        "    dafny:",
        "      executable: /opt/dafny/dafny",
        "      installationRoot: /opt/dafny",
        "      expectedVersion: 4.11.0",
        `      expectedInstallationDigest: ${EXECUTABLE_DIGEST}`,
        "    screening:",
        "      packagePath: /private/kiln-formal-screening",
        "      lemmaScript:",
        "        packageRoot: /opt/lemmascript",
        "        entrypoint: /opt/lemmascript/tools/dist/lsc.js",
        "        expectedVersion: 0.6.0",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.verification?.formal?.screening).toEqual({
      packagePath: "/private/kiln-formal-screening",
      lemmaScript: {
        packageRoot: "/opt/lemmascript",
        entrypoint: "/opt/lemmascript/tools/dist/lsc.js",
        expectedVersion: "0.6.0",
      },
    });
  });

  it.each([
    [
      "relative package",
      "packagePath: private/screening",
      "verification.formal.screening.packagePath must be an absolute path",
    ],
    [
      "relative LemmaScript root",
      "packageRoot: tools/lemmascript",
      "verification.formal.screening.lemmaScript.packageRoot must be an absolute path",
    ],
    [
      "relative LemmaScript entrypoint",
      "entrypoint: tools/dist/lsc.js",
      "verification.formal.screening.lemmaScript.entrypoint must be an absolute path",
    ],
    [
      "moving LemmaScript version",
      "expectedVersion: latest",
      "verification.formal.screening.lemmaScript.expectedVersion must be a canonical version",
    ],
  ])("readGlobalConfig() rejects a formal screening %s", (_case, replacement, message) => {
    existsSyncMock.mockReturnValue(true);
    const lines = [
      'version: "7"',
      "verification:",
      "  formal:",
      "    dafny:",
      "      executable: /opt/dafny/dafny",
      "      installationRoot: /opt/dafny",
      "      expectedVersion: 4.11.0",
      `      expectedInstallationDigest: ${EXECUTABLE_DIGEST}`,
      "    screening:",
      "      packagePath: /private/kiln-formal-screening",
      "      lemmaScript:",
      "        packageRoot: /opt/lemmascript",
      "        entrypoint: /opt/lemmascript/tools/dist/lsc.js",
      "        expectedVersion: 0.6.0",
    ];
    const field = replacement.split(":", 1)[0]!.trim();
    const index =
      field === "expectedVersion"
        ? lines.findLastIndex((line) => line.trimStart().startsWith(`${field}:`))
        : lines.findIndex((line) => line.trimStart().startsWith(`${field}:`));
    lines[index] = `${lines[index]!.match(/^\s*/u)?.[0] ?? ""}${replacement}`;
    readFileSyncMock.mockReturnValue(lines.join("\n"));

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it.each([
    [
      "unknown nested field",
      ["verification:", "  formal:", "    dafny:", "      path: dafny"],
      "Unknown verification.formal.dafny field: path",
    ],
    [
      "empty executable",
      ["verification:", "  formal:", "    dafny:", '      executable: ""', "      expectedVersion: 4.11.0"],
      "verification.formal.dafny.executable must be a non-empty string",
    ],
    [
      "non-canonical version",
      [
        "verification:",
        "  formal:",
        "    dafny:",
        "      executable: /opt/dafny/dafny",
        "      installationRoot: /opt/dafny",
        "      expectedVersion: 4.11",
      ],
      "verification.formal.dafny.expectedVersion must be a canonical version",
    ],
    [
      "relative installation root",
      [
        "verification:",
        "  formal:",
        "    dafny:",
        "      executable: /opt/dafny/dafny",
        "      installationRoot: tools/dafny",
      ],
      "verification.formal.dafny.installationRoot must be an absolute path",
    ],
    [
      "relative executable",
      ["verification:", "  formal:", "    dafny:", "      executable: dafny"],
      "verification.formal.dafny.executable must be an absolute path",
    ],
  ])("readGlobalConfig() rejects Dafny %s", (_case, lines, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(['version: "7"', ...lines].join("\n"));

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it("rejects a relative Gentle AI executable at admission", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      'version: "7"',
      "verification:",
      "  inferential:",
      "    gentleAi:",
      "      executable: gentle-ai",
    ].join("\n"));

    expect(() => readGlobalConfig()).toThrow(
      "verification.inferential.gentleAi.executable must be an absolute path",
    );
  });

  it("readGlobalConfig() accepts the V7 target-intent catalog and reusable authority profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(canonicalV7GlobalYaml());

    const config = readGlobalConfig();

    expect(config).toMatchObject({
      version: "7",
      targetCatalog: {
        accounts: [{ id: "codex-account" }],
        accountPolicies: [{ id: "codex-policy" }],
        targets: [
          {
            id: "codex-terra",
            kind: "direct",
            providerId: "codex-oauth",
            providerModelId: "gpt-5.6-terra",
          },
          {
            id: "claude-cli",
            kind: "harness",
            providerId: "claude",
            providerModelId: "claude-opus-4-6",
          },
        ],
      },
      authorityProfiles: [
        {
          id: "readonly-scout",
          access: "read-only",
          workingDirectory: "project",
        },
      ],
      targetRouting: { defaultTargetId: "codex-terra" },
      managedAgents: {
        defaultAuthorityProfileId: "readonly-scout",
        intents: [
          {
            id: "reviewer",
            purpose: "Review the requested change",
            authorityProfileId: "readonly-scout",
            target: { mode: "explicit", targetId: "codex-terra" },
          },
        ],
      },
      ui: {
        targetSelection: {
          targetId: "codex-terra",
          accountOverrideId: "codex-account",
        },
      },
    });
  });

  it.each([
    ["managedAgents.routes", "managedAgents:\n  routes: []", "Unknown managedAgents field: routes"],
    [
      "executionCatalog",
      "executionCatalog: { accounts: [], accountPolicies: [], routes: [] }",
      "Unknown global config field: executionCatalog",
    ],
    [
      "executionRouting",
      "executionRouting: { defaultRouteId: codex-terra }",
      "Unknown global config field: executionRouting",
    ],
    [
      "ui.executionRouteSelection",
      "ui:\n  executionRouteSelection: { routeId: codex-terra }",
      "Unknown ui field: executionRouteSelection",
    ],
  ])("readGlobalConfig() rejects obsolete V2 target surface %s", (_case, obsoleteYaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(['version: "7"', obsoleteYaml].join("\n"));

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it.each([
    [
      "default operator target",
      canonicalV7GlobalYaml().replace("defaultTargetId: codex-terra", "defaultTargetId: claude-cli"),
      "targetRouting.defaultTargetId must reference a direct target",
    ],
    [
      "selected operator target",
      canonicalV7GlobalYaml().replace(
        "targetSelection: { targetId: codex-terra",
        "targetSelection: { targetId: claude-cli",
      ),
      "ui.targetSelection.targetId must reference a direct target",
    ],
  ])("readGlobalConfig() rejects a harness as the %s", (_case, yaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(yaml);
    expect(() => readGlobalConfig()).toThrow(message);
  });

  it.each([
    [
      "target IDs",
      canonicalV7GlobalYaml().replace(
        V7_HARNESS_TARGET_INTENT_YAML,
        `${V7_HARNESS_TARGET_INTENT_YAML}\n${V7_DIRECT_TARGET_INTENT_YAML}`,
      ),
      "targetCatalog.targets[2].id must be unique",
    ],
    [
      "authority profile IDs",
      canonicalV7GlobalYaml().replace(
        "targetRouting: { defaultTargetId: codex-terra }",
        "  - { id: readonly-scout, access: read-only, workingDirectory: sandbox }\ntargetRouting: { defaultTargetId: codex-terra }",
      ),
      "authorityProfiles[1].id must be unique",
    ],
  ])("readGlobalConfig() rejects duplicate %s", (_case, yaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(yaml);

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it("readGlobalConfig() rejects the replaced economic policy surface", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      canonicalV7GlobalYaml().replace("  intents:", "  economicPolicies: []\n  intents:"),
    );

    expect(() => readGlobalConfig()).toThrow("Unknown managedAgents field: economicPolicies");
  });

  it.each([
    [
      "default target",
      canonicalV7GlobalYaml().replace("defaultTargetId: codex-terra", "defaultTargetId: missing-target"),
      "targetRouting.defaultTargetId references an unknown target",
    ],
    [
      "selected target",
      canonicalV7GlobalYaml().replace(
        "targetSelection: { targetId: codex-terra",
        "targetSelection: { targetId: missing-target",
      ),
      "ui.targetSelection.targetId references an unknown target",
    ],
    [
      "default authority profile",
      canonicalV7GlobalYaml().replace(
        "defaultAuthorityProfileId: readonly-scout",
        "defaultAuthorityProfileId: missing-profile",
      ),
      "managedAgents.defaultAuthorityProfileId references an unknown authority profile",
    ],
    [
      "intent target",
      canonicalV7GlobalYaml().replace("targetId: codex-terra }, model", "targetId: missing-target }, model"),
      "managedAgents.intents[0].target.targetId references an unknown target",
    ],
  ])("readGlobalConfig() rejects an unknown %s reference", (_case, yaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(yaml);

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it.each([
    ["V1", 'version: "1"', 'Global config version must be "7"'],
    ["legacy direct models", 'version: "7"\ndirectModels: []', "Unknown global config field: directModels"],
    [
      "secret",
      `version: "7"\ntargetCatalog: { evidenceRevision: sha256:${"a".repeat(64)}, accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { creditPosture: disabled, overagePosture: disabled }, token: raw-secret }], accountPolicies: [], targets: [] }`,
      "Unknown targetCatalog.accounts[0] field: token",
    ],
  ])("rejects %s", (_case, yaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(yaml);
    expect(() => readGlobalConfig()).toThrow(message);
  });

  it("readGlobalConfig() accepts GUI target selection preference", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts: [{ id: work, providerId: codex-oauth, credentialId: work, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { creditPosture: disabled, overagePosture: disabled } }]",
        "  accountPolicies: [{ id: work-policy, accountIds: [work], strategy: economic-least-pressure }]",
        "  targets: [{ id: terra, kind: direct, label: Terra, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, accountPolicyId: work-policy, economics: { authBillingChannel: subscription, executionMode: direct, serviceTier: default, fallbackPosture: disabled, overagePosture: disabled, executionEnvelope: { limits: [] } } }]",
        "targetRouting: { defaultTargetId: terra }",
        "ui:",
        "  appearance:",
        "    mode: dark",
        "    themeByScheme: { light: automata, dark: phosphor }",
        "  targetSelection:",
        "    targetId: terra",
        "    accountOverrideId: work",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.ui).toEqual({
      appearance: {
        mode: "dark",
        themeByScheme: { light: "automata", dark: "phosphor" },
      },
      targetSelection: {
        targetId: "terra",
        accountOverrideId: "work",
      },
    });
  });

  it("reads and validates the user-scoped model gateway without secret values", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "modelGateway:",
        "  port: 4819",
        "  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }",
        "  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }",
        "  principals:",
        "    - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }",
        "  virtualModels:",
        "    - { id: codex, targetId: codex-reviewer, capabilities: [text], affinity: { continuity: none } }",
      ].join("\n"),
    );
    expect(resolveGlobalModelGatewayConfig(readGlobalConfig())).toMatchObject({
      port: 4819,
      replay: { hmacKeyEnv: "REPLAY_SECRET" },
    });

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "modelGateway:", "  port: 4819", "  token: raw-secret"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("Invalid global modelGateway");
  });

  it("readGlobalConfig() rejects non-canonical configs", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(['version: "1"', "provider: codex"].join("\n"));

    expect(() => readGlobalConfig()).toThrow(
      'Global config version must be "7". Recreate the canonical config through an explicit adoption flow.',
    );
  });

  it("readGlobalConfig() rejects unknown top-level fields and invalid billing modes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(['version: "7"', "provider: codex"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("Unknown global config field: provider");

    readFileSyncMock.mockReturnValue(['version: "7"', "engines:", "  codex:", "    billing: credits"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("engines.codex.billing has an unknown billing mode");
  });

  it("readGlobalConfig() validates global identity fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "7"', "identity:", "  name: Alex", "  timezone: America/Tijuana"].join("\n"),
    );
    expect(readGlobalConfig()?.identity).toEqual({
      name: "Alex",
      timezone: "America/Tijuana",
    });

    readFileSyncMock.mockReturnValue(['version: "7"', "identity:", "  personality: helpful"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("Unknown identity field: personality");

    readFileSyncMock.mockReturnValue(['version: "7"', "identity:", '  timezone: ""'].join("\n"));
    expect(() => readGlobalConfig()).toThrow("identity.timezone must be a non-empty string");

    readFileSyncMock.mockReturnValue(['version: "7"', "identity:", "  timezone: Not/A_Timezone"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("identity.timezone must be a valid IANA time zone");
  });

  it("readGlobalConfig() validates active instruction profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "7"', "activeInstructionProfiles:", "  - sequel-engineering"].join("\n"),
    );
    expect(readGlobalConfig()?.activeInstructionProfiles).toEqual(["sequel-engineering"]);

    readFileSyncMock.mockReturnValue(['version: "7"', "activeInstructionProfiles:", '  - ""'].join("\n"));
    expect(() => readGlobalConfig()).toThrow("activeInstructionProfiles must be an array of non-empty strings");
  });

  it("readGlobalConfig() validates builtin skill policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "skills:",
        "  builtin:",
        "    enabled: true",
        "    include:",
        "      - tdd-workflow",
        "    exclude:",
        "      - frontend-ux-review",
        "  selection:",
        "    mode: auto",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.skills).toEqual({
      builtin: {
        enabled: true,
        include: ["tdd-workflow"],
        exclude: ["frontend-ux-review"],
      },
      selection: {
        mode: "auto",
      },
    });

    readFileSyncMock.mockReturnValue(['version: "7"', "skills:", "  builtin:", "    enabled: yes"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("skills.builtin.enabled must be a boolean");

    readFileSyncMock.mockReturnValue(['version: "7"', "skills:", "  selection:", "    mode: eager"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("skills.selection.mode must be advisory or auto");

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "skills:",
        "  visibility:",
        "    default: implicit",
        "    overrides:",
        "      planner: explicit-only",
        "      release: disabled",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.skills?.visibility).toEqual({
      default: "implicit",
      overrides: { planner: "explicit-only", release: "disabled" },
    });

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "skills:", "  visibility:", "    overrides:", "      planner: sometimes"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "skills.visibility.overrides.planner must be implicit, explicit-only, or disabled",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "skills:", "  visibility:", "    overrides:", "      Planner: disabled"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "skills.visibility.overrides key must be a lowercase kebab-case skill name: Planner",
    );
  });

  it("does not resolve inherited override properties ahead of a fail-closed default", async () => {
    const { resolveSkillVisibility } = await import("./skill-visibility.js");

    expect(
      resolveSkillVisibility("constructor", {
        visibility: { default: "disabled", overrides: {} },
      }),
    ).toBe("disabled");
  });

  it("readGlobalConfig() validates work governance policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "workGovernance:",
        "  defaultPosture: orchestrate",
        "  requireDelegationFor:",
        "    - architecture",
        "    - managed-agents",
        "  requiredEvidence:",
        "    - surface-map",
        "    - residual-risk",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.workGovernance).toEqual({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "managed-agents"],
      requiredEvidence: ["surface-map", "residual-risk"],
    });

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "workGovernance:", "  requireDelegationFor:", "    - vibes"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("workGovernance.requireDelegationFor contains unsupported trigger: vibes");

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "workGovernance:", "  directExecution:", "    maxFiles: 1"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("Unknown workGovernance field: directExecution");
  });

  it("rejects unknown or widening bounded-work ceiling fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "7"', "workGovernance:", "  boundedWorkCeiling:", "    unexpected: true"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("Unknown workGovernance.boundedWorkCeiling field: unexpected");

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "workGovernance:",
        "  boundedWorkCeiling:",
        "    maximumLimits:",
        "      maxExecutionAttempts: 0",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("maximumLimits.maxExecutionAttempts must be a positive safe integer");

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "workGovernance:",
        "  boundedWorkCeiling:",
        "    maximumLimits:",
        "      maxToolCalls: 20",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown workGovernance.boundedWorkCeiling.maximumLimits field: maxToolCalls",
    );
  });

  it("readGlobalConfig() accepts web provider defaults", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "web:",
        "  searchProvider:",
        "    type: tavily",
        "    apiKeyEnv: TAVILY_API_KEY",
        "  extractProvider:",
        "    type: firecrawl",
        "    apiKeyEnv: FIRECRAWL_API_KEY",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.web).toEqual({
      searchProvider: {
        type: "tavily",
        apiKeyEnv: "TAVILY_API_KEY",
      },
      extractProvider: {
        type: "firecrawl",
        apiKeyEnv: "FIRECRAWL_API_KEY",
      },
    });
  });

  it("readGlobalConfig() accepts governed operator voice defaults", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "    commandEnv: KILN_WHISPER_COMMAND",
        "    model: base",
        "    language: English",
        "  tts:",
        "    provider: kokoro-local",
        "    commandEnv: KILN_KOKORO_COMMAND",
        "    model: kokoro-v1",
        "    voice: af_bella",
        "    format: wav",
        "  policy:",
        "    surfaces:",
        "      gui:",
        "        enabled: true",
        "        input:",
        "          modes: [microphone, file]",
        "        output:",
        "          modes: [audio-response, transcript-only]",
        "      tui:",
        "        enabled: true",
        "        output:",
        "          modes: [artifact-only, transcript-only]",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.operatorVoice).toMatchObject({
      stt: {
        provider: "whisper-local",
        commandEnv: "KILN_WHISPER_COMMAND",
      },
      tts: {
        provider: "kokoro-local",
        commandEnv: "KILN_KOKORO_COMMAND",
        voice: "af_bella",
      },
      policy: {
        surfaces: {
          gui: {
            enabled: true,
          },
          tui: {
            enabled: true,
          },
        },
      },
    });
  });

  it("readGlobalConfig() accepts authority-profile voice references from operator voice catalog", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "  tts:",
        "    provider: kokoro-local",
        "  ttsProfiles:",
        "    reviewer-voice:",
        "      style: calm reviewer",
        "      voice: af_bella",
        "      speed: 1",
        "authorityProfiles:",
        "  - id: reviewer-authority",
        "    access: read-only",
        "    voiceProfile: reviewer-voice",
        "managedAgents:",
        "  enabled: true",
        "  defaultVoiceProfile: reviewer-voice",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.managedAgents).toMatchObject({
      defaultVoiceProfile: "reviewer-voice",
    });
    expect(readGlobalConfig()?.authorityProfiles).toEqual([
      expect.objectContaining({
        id: "reviewer-authority",
        voiceProfile: "reviewer-voice",
      }),
    ]);
  });

  it("readGlobalConfig() rejects authority-profile voice references outside operator voice catalog", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "  tts:",
        "    provider: kokoro-local",
        "  ttsProfiles:",
        "    reviewer-voice:",
        "      style: calm reviewer",
        "      voice: af_bella",
        "      speed: 1",
        "authorityProfiles:",
        "  - id: reviewer-authority",
        "    access: read-only",
        "    voiceProfile: missing-voice",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'authorityProfiles[0].voiceProfile references unknown operatorVoice.ttsProfiles entry "missing-voice"',
    );
  });

  it("readGlobalConfig() rejects invalid operator voice config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "operatorVoice:",
        "  stt:",
        "    provider: imaginary-stt",
        "  tts:",
        "    provider: kokoro-local",
        "    commandEnv: KILN_KOKORO_COMMAND",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "operatorVoice.voice.stt.provider must be one of: openai, deepgram, whisper-local",
    );
  });

  it("readGlobalConfig() accepts global web capability ceilings", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "7"', "web:", "  enabled: true", "  netPolicy: full", "  allowedDomains: ['*']"].join("\n"),
    );

    expect(readGlobalConfig()?.web).toEqual({
      enabled: true,
      netPolicy: "full",
      allowedDomains: ["*"],
    });
  });

  it("readGlobalConfig() accepts the managed Oxlint capability opt-in", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "verification:",
        "  static:",
        "    oxlint:",
        "      enabled: true",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.verification).toEqual({
      static: {
        oxlint: { enabled: true },
      },
    });
  });

  it.each([
    [
      "unknown nested field",
      ["verification:", "  static:", "    oxlint:", "      path: oxlint"],
      "Unknown verification.static.oxlint field: path",
    ],
    [
      "disabled managed provider",
      ["verification:", "  static:", "    oxlint:", "      enabled: false"],
      "verification.static.oxlint.enabled must be true",
    ],
    [
      "missing opt-in",
      ["verification:", "  static:", "    oxlint: {}"],
      "verification.static.oxlint.enabled must be true",
    ],
  ])("readGlobalConfig() rejects Oxlint %s", (_case, lines, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(['version: "7"', ...lines].join("\n"));

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it.each([
    ["unknown theme", "custom-theme", "phosphor", "must reference a built-in operator theme"],
    ["wrong light polarity", "vesper", "phosphor", "has no light variant"],
    ["wrong dark polarity", "automata", "automata", "has no dark variant"],
  ])("rejects %s in canonical appearance", (_case, light, dark, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "ui:",
        "  appearance:",
        "    mode: system",
        `    themeByScheme: { light: ${light}, dark: ${dark} }`,
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it("readGlobalConfig() rejects invalid target catalog references and account policies", () => {
    existsSyncMock.mockReturnValue(true);
    const valid = [
      'version: "7"',
      "targetCatalog:",
      `  evidenceRevision: sha256:${"a".repeat(64)}`,
      "  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { creditPosture: disabled, overagePosture: disabled } }]",
      "  accountPolicies: [{ id: policy, accountIds: [account], strategy: economic-least-pressure }]",
      "  targets: [{ id: route, kind: direct, label: Route, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, accountPolicyId: policy, economics: { authBillingChannel: subscription, executionMode: direct, serviceTier: default, fallbackPosture: disabled, overagePosture: disabled, executionEnvelope: { limits: [] } } }]",
      "targetRouting: { defaultTargetId: route }",
    ].join("\n");

    readFileSyncMock.mockReturnValue(valid.replace("accountPolicyId: policy", "accountPolicyId: missing"));
    expect(() => readGlobalConfig()).toThrow("references an unknown account policy");

    readFileSyncMock.mockReturnValue(
      valid.replaceAll("providerId: codex-oauth, providerModelId", "providerId: other-provider, providerModelId"),
    );
    expect(() => readGlobalConfig()).toThrow("provider must match target providerId");

    readFileSyncMock.mockReturnValue(valid.replace("defaultTargetId: route", "defaultTargetId: missing"));
    expect(() => readGlobalConfig()).toThrow("targetRouting.defaultTargetId references an unknown target");

    readFileSyncMock.mockReturnValue(
      valid.replace("defaultTargetId: route", "defaultTargetId: route, fallbackTargetIds: []"),
    );
    expect(() => readGlobalConfig()).toThrow("Unknown targetRouting field: fallbackTargetIds.");

    readFileSyncMock.mockReturnValue(valid.replace("dataClassification: internal, ", ""));
    expect(() => readGlobalConfig()).toThrow("targetCatalog.targets[0].dataClassification is invalid");

    readFileSyncMock.mockReturnValue(
      valid.replace(
        "dataClassification: internal",
        "dataClassification: internal, dataPolicyEvidence: { rawPolicy: secret }",
      ),
    );
    expect(() => readGlobalConfig()).toThrow("Unknown targetCatalog.targets[0] field: dataPolicyEvidence");
  });

  it("readGlobalConfig() validates model task suitability overrides", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "modelTaskSuitability:",
        "  - provider: codex-oauth",
        "    model: gpt-5.4-mini",
        "    task: frontend-design",
        "    level: limited",
        "    reason: Prefer a visual-design route when available.",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.modelTaskSuitability).toEqual([
      {
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Prefer a visual-design route when available.",
      },
    ]);

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "modelTaskSuitability:",
        "  - provider: codex-oauth",
        "    model: gpt-5.4-mini",
        "    task: frontend-design",
        "    level: best",
        "    reason: Invalid level.",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'modelTaskSuitability[0].level must be "preferred", "capable", or "limited"',
    );
  });

  it("readGlobalConfig() validates provider-neutral deliberation policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "deliberationPolicy:",
        "  default:",
        "    mode: adaptive",
        "    target: balanced",
        "    onUnsupported: deny",
        "  byTask:",
        "    architecture-review:",
        "      mode: adaptive",
        "      target: quality-first",
        "      bounds:",
        "        min: medium",
        "        max: xhigh",
        "  byRoute:",
        "    - provider: codex-oauth",
        "      model: gpt-test",
        "      mode: fixed",
        "      preferredLevel: xhigh",
        "      onUnsupported: allow-clamp",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.deliberationPolicy).toEqual({
      default: {
        mode: "adaptive",
        target: "balanced",
        onUnsupported: "deny",
      },
      byTask: {
        "architecture-review": {
          mode: "adaptive",
          target: "quality-first",
          bounds: { min: "medium", max: "xhigh" },
        },
      },
      byRoute: [
        {
          provider: "codex-oauth",
          model: "gpt-test",
          mode: "fixed",
          preferredLevel: "xhigh",
          onUnsupported: "allow-clamp",
        },
      ],
    });

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "deliberationPolicy:", "  byTask:", "    frontend-design:", "      mode: fixed"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "deliberationPolicy.byTask.frontend-design.preferredLevel is required when mode is fixed",
    );

    readFileSyncMock.mockReturnValue(['version: "7"', "reasoningPolicy:", "  default: medium"].join("\n"));

    expect(() => readGlobalConfig()).toThrow("Unknown global config field: reasoningPolicy");
  });

  it("readGlobalConfig() validates authority profile write authority shape", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "authorityProfiles:",
        "  - id: approved-write",
        "    access: approved-write",
        "    writeAuthority:",
        "      workspace:",
        "        mode: apply-approved",
        "        allowedPaths:",
        "          - packages/cli/src/config",
        "      approval:",
        "        mode: required-before-apply",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.authorityProfiles?.[0]?.writeAuthority).toMatchObject({
      workspace: {
        mode: "apply-approved",
        allowedPaths: ["packages/cli/src/config"],
      },
      approval: {
        mode: "required-before-apply",
      },
    });

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "authorityProfiles:",
        "  - id: approved-write",
        "    access: approved-write",
        "    writeAuthority:",
        "      approval:",
        "        mode: auto",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'authorityProfiles[0].writeAuthority.approval.mode must be "required-before-apply" or "policy-approved"',
    );
  });

  it("readGlobalConfig() accepts managed-agent git worktree lease configuration", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "managedAgents:",
        "  enabled: true",
        "  worktreeLease:",
        "    mode: git",
        "    rootPath: .kiln/managed-worktrees",
        "    ref: HEAD",
        "authorityProfiles:",
        "  - id: approved-write",
        "    access: approved-write",
        "    workingDirectory: isolated-worktree",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.managedAgents).toMatchObject({
      worktreeLease: {
        mode: "git",
        rootPath: ".kiln/managed-worktrees",
        ref: "HEAD",
      },
    });
    expect(readGlobalConfig()?.authorityProfiles?.[0]).toMatchObject({
      id: "approved-write",
      workingDirectory: "isolated-worktree",
    });
  });

  it("readGlobalConfig() accepts sandbox authority profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "authorityProfiles:",
        "  - id: sandbox-readonly",
        "    access: read-only",
        "    workingDirectory: sandbox",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.authorityProfiles?.[0]).toMatchObject({
      id: "sandbox-readonly",
      workingDirectory: "sandbox",
    });
  });

  it("readGlobalConfig() validates remote harness route endpoint shape", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        "      remoteHarness:",
        "        invokeUrl: https://remote.example.test/managed-agent/invoke",
        "        cancelUrl: https://remote.example.test/managed-agent/cancel",
        "        authTokenEnv: KILN_REMOTE_HARNESS_TOKEN",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.targetCatalog?.targets[0]?.remoteHarness).toEqual({
      invokeUrl: "https://remote.example.test/managed-agent/invoke",
      cancelUrl: "https://remote.example.test/managed-agent/cancel",
      authTokenEnv: "KILN_REMOTE_HARNESS_TOKEN",
    });

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        "      remoteHarness:",
        "        invokeUrl: https://remote.example.test/managed-agent/invoke",
        "        cancelUrl: https://remote.example.test/managed-agent/cancel",
        "        limitations: [aggregate-only]",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "targetCatalog.targets[0].remoteHarness.limitations is managed evidence and cannot be declared as intent",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        "      remoteHarness:",
        "        invokeUrl: https://remote.example.test/managed-agent/invoke",
        "        cancelUrl: ''",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "targetCatalog.targets[0].remoteHarness.cancelUrl must be a non-empty HTTPS URL string",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "targetCatalog:",
        `  evidenceRevision: sha256:${"a".repeat(64)}`,
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        "      remoteHarness:",
        "        invokeUrl: http://remote.example.test/managed-agent/invoke",
        "        cancelUrl: https://remote.example.test/managed-agent/cancel",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "targetCatalog.targets[0].remoteHarness.invokeUrl must be a non-empty HTTPS URL string",
    );
  });

  it("readGlobalConfig() rejects malformed managed-agent worktree lease configuration", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "managedAgents:",
        "  worktreeLease:",
        "    mode: shell",
        "    rootPath: .kiln/managed-worktrees",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow('managedAgents.worktreeLease.mode must be "git"');

    readFileSyncMock.mockReturnValue(
      ['version: "7"', "managedAgents:", "  worktreeLease:", "    mode: git"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("managedAgents.worktreeLease.rootPath is required");

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "authorityProfiles:",
        "  - id: invalid-workdir",
        "    access: read-only",
        "    workingDirectory: shared-checkout",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("authorityProfiles[0].workingDirectory is invalid");

    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "managedAgents:",
        "  worktreeLease:",
        "    mode: git",
        "    rootPath: .kiln/managed-worktrees",
        "    gitBianary: git",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("Unknown managedAgents.worktreeLease field: gitBianary");
  });

  it("readGlobalConfig() rejects unknown authority-profile tool fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "7"',
        "authorityProfiles:",
        "  - id: readonly-scout",
        "    access: read-only",
        "    tools: { allowed: [resource_read], shell: true }",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("Unknown authorityProfiles[0].tools field: shell");
  });

  it("readGlobalConfig() rejects unsupported authority-profile memory access", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
      'version: "7"',
        "authorityProfiles:",
        "  - id: readonly-scout",
        "    access: read-only",
        "    memory: { access: unrestricted }",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'authorityProfiles[0].memory.access must be "none", "read-only", or "write-proposals"',
    );
  });

  it("readGlobalConfig() throws KilnYamlError when file is not a YAML object", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("- not\n- an\n- object\n");

    expect(() => readGlobalConfig()).toThrow(KilnYamlError);
    expect(() => readGlobalConfig()).toThrow("Global config must be an object");
  });

  it("commitGlobalConfigBytes() atomically replaces on Windows without unlinking the destination", () => {
    existsSyncMock.mockImplementation((path: string) => String(path).endsWith("config.yaml"));
    readFileSyncMock
      .mockReturnValueOnce('version: "7"\nidentity:\n  name: before\n')
      .mockReturnValueOnce('version: "7"\nidentity:\n  name: after\n');
    statSyncMock.mockReturnValue({ mode: 0o100640 });

    const currentRaw = 'version: "7"\nidentity:\n  name: before\n';
    const result = commitGlobalConfigForTest({
      currentRaw,
      content: 'version: "7"\nidentity:\n  name: after\n',
    });

    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    const temporaryPath = renameSyncMock.mock.calls[0]?.[0] as string;
    expect(temporaryPath).toMatch(
      new RegExp(`${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f-]+\\.tmp$`, "i"),
    );
    expect(mkdirSyncMock).toHaveBeenCalledWith(join("/home/test-user", ".kiln"), { recursive: true });
    expect(openSyncMock).toHaveBeenCalledWith(lockPath, "wx", 0o600);
    expect(openSyncMock.mock.invocationCallOrder[0]).toBeLessThan(readFileSyncMock.mock.invocationCallOrder[0]!);
    expect(writeFileSyncMock).toHaveBeenCalledWith(temporaryPath, expect.stringContaining("name: after"), {
      encoding: "utf-8",
      mode: 0o640,
    });
    expect(chmodSyncMock).toHaveBeenCalledWith(temporaryPath, 0o640);
    expect(renameSyncMock).toHaveBeenCalledWith(temporaryPath, configPath);
    expect(rmSyncMock).not.toHaveBeenCalledWith(configPath, expect.anything());
    expect(rmSyncMock).toHaveBeenCalledWith(temporaryPath, { force: true });
    const releasePath = renameSyncMock.mock.calls.find(([from]) => from === lockPath)?.[1] as string;
    expect(releasePath).toMatch(/\.lock\.release-[0-9a-f-]+$/i);
    expect(closeSyncMock.mock.invocationCallOrder.at(-1)).toBeLessThan(rmSyncMock.mock.invocationCallOrder.at(-1)!);
    expect(rmSyncMock).toHaveBeenCalledWith(releasePath, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
    expect(result.previousRevision).toMatch(/^sha256:/);
    expect(result.revision).toMatch(/^sha256:/);
    expect(result.revision).not.toBe(result.previousRevision);
  });

  it("commitGlobalConfigBytes() returns deterministic revision conflict evidence", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('version: "7"\n');
    expect(() =>
      commitGlobalConfigBytes({
        content: 'version: "7"\n',
        expectedRevision: "sha256:stale",
      }),
    ).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_REVISION_CONFLICT",
        evidence: expect.objectContaining({ expectedRevision: "sha256:stale" }),
      }),
    );
    expect(writeFileSyncMock.mock.calls.some(([path]) => typeof path === "string")).toBe(false);
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${join("/home/test-user", ".kiln", "config.yaml")}.lock`, {
      force: true,
    });
  });

  it("commitGlobalConfigBytes() cannot delete a successor lock acquired after its atomic release claim", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('version: "7"\n');
    statSyncMock.mockReturnValue({ mode: 0o100600 });
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    let successorAcquired = false;
    renameSyncMock.mockImplementation((from: string, destination: string) => {
      if (from === lockPath && destination.includes(".release-")) successorAcquired = true;
    });
    rmSyncMock.mockImplementation((path: string) => {
      if (successorAcquired && path === lockPath) throw new Error("successor lock was deleted");
    });

    expect(() => commitGlobalConfigForTest()).not.toThrow();

    expect(successorAcquired).toBe(true);
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
    expect(rmSyncMock).toHaveBeenCalledWith(expect.stringContaining(".lock.release-"), { force: true });
  });

  it("commitGlobalConfigBytes() ownership-safely claims a partially initialized lock before cleanup", () => {
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    fsyncSyncMock.mockImplementation(() => {
      throw new Error("lock fsync failed");
    });

    expect(() => commitGlobalConfigForTest({ currentRaw: null })).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );

    const releasePath = renameSyncMock.mock.calls.find(([from]) => from === lockPath)?.[1] as string;
    expect(releasePath).toMatch(/\.lock\.release-[0-9a-f-]+$/i);
    expect(renameSyncMock).toHaveBeenCalledWith(lockPath, releasePath);
    expect(closeSyncMock).toHaveBeenCalledWith(7);
    expect(rmSyncMock).toHaveBeenCalledWith(releasePath, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
  });

  it("commitGlobalConfigBytes() reports lock contention and does not read or write config", () => {
    openSyncMock.mockImplementation(() => {
      const error = new Error("exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });

    expect(() => commitGlobalConfigForTest({ currentRaw: null })).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );
    expect(readFileSyncMock).toHaveBeenCalledWith(`${join("/home/test-user", ".kiln", "config.yaml")}.lock`, "utf-8");
    expect(readFileSyncMock.mock.calls.some(([path]) => path === join("/home/test-user", ".kiln", "config.yaml"))).toBe(
      false,
    );
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(rmSyncMock).not.toHaveBeenCalled();
  });

  it("commitGlobalConfigBytes() cleans its temporary and lock files when atomic replacement fails", () => {
    existsSyncMock.mockReturnValue(false);
    renameSyncMock.mockImplementation((from: string) => {
      if (from.endsWith(".tmp")) throw new Error("replace failed");
    });

    expect(() => commitGlobalConfigForTest({ currentRaw: null })).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_WRITE_FAILED",
      }),
    );
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const temporaryPath = renameSyncMock.mock.calls[0]?.[0] as string;
    expect(rmSyncMock).toHaveBeenCalledWith(temporaryPath, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.lock`, {
      force: true,
    });
  });

  it("commitGlobalConfigBytes() recovers a dead owner's lock and its exact temporary file", () => {
    const staleAcquisitionId = "11111111-1111-4111-8111-111111111111";
    openSyncMock
      .mockImplementationOnce(() => {
        const error = new Error("exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      })
      .mockReturnValueOnce(8);
    readFileSyncMock.mockImplementation((path: string | number) => {
      if (String(path).includes(".lock")) {
        return JSON.stringify({
          pid: 424242,
          acquiredAt: "2026-08-11T12:00:00.000Z",
          acquisitionId: staleAcquisitionId,
        });
      }
      return 'version: "7"\n';
    });
    existsSyncMock.mockReturnValue(false);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("not found") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });

    commitGlobalConfigForTest({ currentRaw: null });

    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    expect(kill).toHaveBeenCalledWith(424242, 0);
    expect(rmSyncMock).toHaveBeenCalledWith(`${configPath}.${staleAcquisitionId}.tmp`, { force: true });
    expect(renameSyncMock).toHaveBeenCalledWith(
      `${configPath}.lock`,
      expect.stringMatching(/\.lock\.recovery-[0-9a-f-]+$/i),
    );
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.lock`, {
      force: true,
    });
    expect(openSyncMock).toHaveBeenCalledTimes(2);
  });

  it("commitGlobalConfigBytes() does not clean a stale lock claimed first by a competing recoverer", () => {
    const staleAcquisitionId = "11111111-1111-4111-8111-111111111111";
    openSyncMock.mockImplementation(() => {
      const error = new Error("exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        pid: 424242,
        acquiredAt: "2026-08-11T12:00:00.000Z",
        acquisitionId: staleAcquisitionId,
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("not found") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });
    renameSyncMock.mockImplementation(() => {
      const error = new Error("already claimed") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    expect(() => commitGlobalConfigForTest({ currentRaw: null })).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.${staleAcquisitionId}.tmp`, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.lock`, {
      force: true,
    });
  });

  it("commitGlobalConfigBytes() backs up invalid bytes while holding the lock before replacement", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValueOnce("invalid: [\n").mockReturnValueOnce('version: "7"\n');
    statSyncMock.mockReturnValue({ mode: 0o100600 });

    const result = commitGlobalConfigForTest({
      currentRaw: "invalid: [\n",
      content: 'version: "7"\n',
      invalidCurrent: "backup-and-replace",
    });

    expect(result.invalidBackupPath).toMatch(/config\.yaml\.invalid-[0-9a-f-]+\.bak$/i);
    expect(writeFileSyncMock).toHaveBeenCalledWith(result.invalidBackupPath, "invalid: [\n", {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });
    const backupOrder = writeFileSyncMock.mock.invocationCallOrder[1]!;
    expect(openSyncMock.mock.invocationCallOrder[0]).toBeLessThan(backupOrder);
    expect(backupOrder).toBeLessThan(renameSyncMock.mock.invocationCallOrder[0]!);
  });

  it("commitGlobalConfigBytes() fails closed when lock owner liveness is unknown", () => {
    openSyncMock.mockImplementation(() => {
      const error = new Error("exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        pid: 424242,
        acquiredAt: "2026-08-11T12:00:00.000Z",
        acquisitionId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("denied") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });

    expect(() => commitGlobalConfigForTest({ currentRaw: null })).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
        evidence: expect.objectContaining({ lockOwnerPid: 424242 }),
      }),
    );
    expect(renameSyncMock).not.toHaveBeenCalled();
  });

  it("defaultGlobalConfig() returns expected shape", () => {
    expect(defaultGlobalConfig()).toEqual({
      version: "7",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: false, billing: "plus-quota" },
        opencode: { enabled: false, billing: "free" },
      },
      permissions: {
        approval: "on-request",
        sandbox: "read-only",
      },
      permissionCeiling: {
        approval: "on-request",
        sandbox: "workspace-write",
      },
      skills: {
        builtin: {
          enabled: true,
        },
      },
      workGovernance: {
        defaultPosture: "direct",
        requireDelegationFor: [],
        requiredEvidence: [],
      },
      ui: {
        appearance: {
          mode: "system",
          themeByScheme: { light: "tesota", dark: "tesota" },
        },
      },
      components: {
        include: ["baseline:core"],
      },
    });
  });

  it("resolves provider, model, and UI theme through projection helpers", () => {
    const config = {
      version: "7" as const,
      targetCatalog: {
        accounts: [
          {
            id: "account",
            providerId: "codex-oauth",
            credentialId: "credential",
            maxConcurrency: 1,
            reservedAffinitySlots: 0,
            economics: {
              capacityIdentity: "account",
              subscriptionClass: "subscription",
              quotaClassId: "quota",
              creditPosture: "disabled",
              overagePosture: "disabled",
            },
          },
        ],
        accountPolicies: [
          {
            id: "policy",
            accountIds: ["account"],
            strategy: "economic-least-pressure" as const,
          },
        ],
        targets: [
          {
            id: "terra",
            kind: "direct" as const,
            label: "Terra",
            providerId: "codex-oauth",
            providerModelId: "gpt-5.6-terra",
            dataClassification: "internal" as const,
            dataPolicyEvidence: {
              providerId: "codex-oauth",
              providerModelId: "gpt-5.6-terra",
              dataUse: "not-used" as const,
              trainingPosture: "prohibited" as const,
              retention: { posture: "zero" as const, days: 0 },
              permittedMaximumClassification: "internal" as const,
              permittedClassifications: ["public", "internal"] as const,
              sourceIdentity: "fixture-privacy",
              sourceRevision: "rev-1",
              sourceDigest: `sha256:${"e".repeat(64)}` as const,
              observedAt: "2026-01-01T00:00:00Z",
              expiresAt: "2027-01-01T00:00:00Z",
            },
            accountPolicyId: "policy",
            economics: {
              adapterCapabilityId: "adapter",
              adapterCapabilityVersion: "v1",
              authBillingChannel: "subscription",
              executionMode: "direct",
              serviceTier: "default",
              rateCardBasis: "subscription",
              envelopeSemantics: "request",
              fallbackPosture: "disabled" as const,
              overagePosture: "disabled" as const,
              contextClass: "standard",
              cacheClass: "none",
              priceEvidence: {
                kind: "subscription" as const,
                rateCardId: "card",
                rateCardRevision: "v1",
                evidence: {
                  sourceIdentity: "provider",
                  sourceRevision: "v1",
                  sourceDigest: "digest",
                  observedAt: "2026-01-01",
                  validUntil: "2027-01-01",
                  confidence: "high" as const,
                  authority: "configured" as const,
                },
              },
              auxiliaryCharges: [],
              executionEnvelope: { limits: [] },
            },
          },
        ],
      },
      targetRouting: { defaultTargetId: "terra" },
      ui: {
        appearance: { mode: "dark", themeByScheme: { light: "automata", dark: "vesper" } },
      },
    };

    expect(resolveGlobalDefaultProvider(config)).toBe("codex-oauth");
    expect(resolveGlobalDefaultModel(config)).toBe("gpt-5.6-terra");
    expect(resolveGlobalUiAppearance(config)).toEqual({
      mode: "dark",
      themeByScheme: { light: "automata", dark: "vesper" },
    });
  });
});
