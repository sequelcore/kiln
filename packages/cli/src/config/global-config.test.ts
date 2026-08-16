import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  defaultGlobalConfig,
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
  resolveGlobalUiTheme,
  resolveGlobalConfigPath,
  resolveGlobalModelGatewayConfig,
  GlobalConfigMutationError,
  mutateGlobalConfig,
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

const V3_DIRECT_TARGET_YAML = `    - { id: codex-terra, kind: direct, label: Codex Terra, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, dataPolicyEvidence: { providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"f".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }, accountSelection: { mode: automatic, accountPolicyId: codex-policy }, economics: { adapterCapabilityId: codex-oauth, adapterCapabilityVersion: v1, authBillingChannel: subscription, executionMode: direct, serviceTier: default, rateCardBasis: configured, envelopeSemantics: bounded, fallbackPosture: disabled, overagePosture: disabled, contextClass: standard, cacheClass: none, priceEvidence: { kind: subscription, rateCardId: codex, rateCardRevision: v1, evidence: { sourceIdentity: global-config.test, sourceRevision: v1, sourceDigest: fixture, observedAt: 2026-01-01T00:00:00Z, validUntil: 2027-01-01T00:00:00Z, confidence: high, authority: configured } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }`;
const V3_HARNESS_TARGET_YAML = `    - { id: claude-cli, kind: harness, label: Claude CLI, providerId: claude, providerModelId: claude-opus-4-6, dataClassification: internal, dataPolicyEvidence: { providerId: claude, providerModelId: claude-opus-4-6, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"e".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z } }`;

function canonicalV3GlobalYaml(): string {
  return [
    'version: "3"',
    "targetCatalog:",
    "  accounts: [{ id: codex-account, providerId: codex-oauth, credentialId: codex-credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: codex-account, subscriptionClass: subscription, quotaClassId: codex, creditPosture: disabled, overagePosture: disabled } }]",
    "  accountPolicies: [{ id: codex-policy, accountIds: [codex-account], strategy: economic-least-pressure }]",
    "  targets:",
    V3_DIRECT_TARGET_YAML,
    V3_HARNESS_TARGET_YAML,
    "authorityProfiles:",
    "  - { id: readonly-scout, admissionProfile: foundation-readonly-plan, workingDirectory: project }",
    "targetRouting: { defaultTargetId: codex-terra }",
    "managedAgents:",
    "  defaultAuthorityProfileId: readonly-scout",
    "  economicPolicies:",
    "    - id: economical",
    "      revision: rev-1",
    "      evidenceRequirements: { quota: optional, price: optional }",
    "      noRouteAction: deny",
    "      comparisonDomains:",
    "        - { id: priority-only, rank: 0, unit: request, scheme: { kind: unit }, rateCardBasis: configured, envelopeSemantics: bounded }",
    "      candidates:",
    "        - { targetId: codex-terra, comparisonDomainId: priority-only, priorityRank: 0, ceiling: { kind: none }, worstCaseReservation: { kind: not-comparable, reason: subscription-basis } }",
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

  it("readGlobalConfig() returns null when file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const config = readGlobalConfig();

    expect(config).toBeNull();
  });

  it("readGlobalConfig() parses and returns valid config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "targetCatalog:",
        "  accounts:",
        "    - { id: codex-primary, providerId: codex-oauth, credentialId: codex-primary, maxConcurrency: 2, reservedAffinitySlots: 1, economics: { capacityIdentity: codex-primary, subscriptionClass: subscription, quotaClassId: codex, creditPosture: disabled, overagePosture: disabled } }",
        "  accountPolicies:",
        "    - { id: codex-automatic, accountIds: [codex-primary], strategy: economic-least-pressure }",
        "  targets:",
        "    - id: terra",
        "      kind: direct",
        "      label: Terra",
        "      providerId: codex-oauth",
        "      providerModelId: codex/gpt-5.6-terra",
        "      dataClassification: internal",
        `      dataPolicyEvidence: { providerId: codex-oauth, providerModelId: codex/gpt-5.6-terra, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"b".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }`,
        "      accountSelection: { mode: automatic, accountPolicyId: codex-automatic }",
        "      economics: { adapterCapabilityId: codex-oauth, adapterCapabilityVersion: v1, authBillingChannel: subscription, executionMode: direct, serviceTier: default, rateCardBasis: subscription, envelopeSemantics: request, fallbackPosture: disabled, overagePosture: disabled, contextClass: standard, cacheClass: none, priceEvidence: { kind: subscription, rateCardId: codex, rateCardRevision: v1, evidence: { sourceIdentity: provider, sourceRevision: v1, sourceDigest: digest, observedAt: 2026-01-01T00:00:00Z, validUntil: 2027-01-01T00:00:00Z, confidence: high, authority: configured } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } }",
        "targetRouting:",
        "  defaultTargetId: terra",
      ].join("\n"),
    );

    const config = readGlobalConfig();

    expect(config).toEqual({
      version: "3",
      targetCatalog: {
        accounts: [
          {
            id: "codex-primary",
            providerId: "codex-oauth",
            credentialId: "codex-primary",
            maxConcurrency: 2,
            reservedAffinitySlots: 1,
            economics: {
              capacityIdentity: "codex-primary",
              subscriptionClass: "subscription",
              quotaClassId: "codex",
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
            dataPolicyEvidence: {
              providerId: "codex-oauth",
              providerModelId: "codex/gpt-5.6-terra",
              dataUse: "not-used",
              trainingPosture: "prohibited",
              retention: { posture: "zero", days: 0 },
              permittedMaximumClassification: "internal",
              permittedClassifications: ["public", "internal"],
              sourceIdentity: "fixture-privacy",
              sourceRevision: "rev-1",
              sourceDigest: `sha256:${"b".repeat(64)}`,
              observedAt: "2026-01-01T00:00:00Z",
              expiresAt: "2027-01-01T00:00:00Z",
            },
            accountSelection: {
              mode: "automatic",
              accountPolicyId: "codex-automatic",
            },
            economics: {
              adapterCapabilityId: "codex-oauth",
              adapterCapabilityVersion: "v1",
              authBillingChannel: "subscription",
              executionMode: "direct",
              serviceTier: "default",
              rateCardBasis: "subscription",
              envelopeSemantics: "request",
              fallbackPosture: "disabled",
              overagePosture: "disabled",
              contextClass: "standard",
              cacheClass: "none",
              priceEvidence: {
                kind: "subscription",
                rateCardId: "codex",
                rateCardRevision: "v1",
                evidence: {
                  sourceIdentity: "provider",
                  sourceRevision: "v1",
                  sourceDigest: "digest",
                  observedAt: "2026-01-01T00:00:00Z",
                  validUntil: "2027-01-01T00:00:00Z",
                  confidence: "high",
                  authority: "configured",
                },
              },
              auxiliaryCharges: [],
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

  it("readGlobalConfig() accepts the V3 target catalog and reusable authority profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(canonicalV3GlobalYaml());

    const config = readGlobalConfig();

    expect(config).toMatchObject({
      version: "3",
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
          admissionProfile: "foundation-readonly-plan",
          workingDirectory: "project",
        },
      ],
      targetRouting: { defaultTargetId: "codex-terra" },
      managedAgents: {
        defaultAuthorityProfileId: "readonly-scout",
        economicPolicies: [{ candidates: [{ targetId: "codex-terra" }] }],
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
    [
      "managedAgents.routes",
      "managedAgents:\n  routes: []",
      "Unknown managedAgents field: routes",
    ],
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
  ])(
    "readGlobalConfig() rejects obsolete V2 target surface %s",
    (_case, obsoleteYaml, message) => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        ['version: "3"', obsoleteYaml].join("\n"),
      );

      expect(() => readGlobalConfig()).toThrow(message);
    },
  );

  it.each([
    [
      "default operator target",
      canonicalV3GlobalYaml().replace("defaultTargetId: codex-terra", "defaultTargetId: claude-cli"),
      "targetRouting.defaultTargetId must reference a direct target",
    ],
    [
      "selected operator target",
      canonicalV3GlobalYaml().replace("targetSelection: { targetId: codex-terra", "targetSelection: { targetId: claude-cli"),
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
      canonicalV3GlobalYaml().replace(
        V3_HARNESS_TARGET_YAML,
        `${V3_HARNESS_TARGET_YAML}\n${V3_DIRECT_TARGET_YAML}`,
      ),
      "targetCatalog.targets[2].id must be unique",
    ],
    [
      "authority profile IDs",
      canonicalV3GlobalYaml().replace(
        "targetRouting: { defaultTargetId: codex-terra }",
        "  - { id: readonly-scout, admissionProfile: foundation-readonly-plan, workingDirectory: sandbox }\ntargetRouting: { defaultTargetId: codex-terra }",
      ),
      "authorityProfiles[1].id must be unique",
    ],
  ])("readGlobalConfig() rejects duplicate %s", (_case, yaml, message) => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(yaml);

    expect(() => readGlobalConfig()).toThrow(message);
  });

  it("readGlobalConfig() requires economic candidates to use targetId", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      canonicalV3GlobalYaml().replace(
        "targetId: codex-terra, comparisonDomainId",
        "routeId: codex-terra, comparisonDomainId",
      ),
    );

    expect(() => readGlobalConfig()).toThrow(
      "Unknown managedAgents.economicPolicies[0].candidates[0] field: routeId",
    );
  });

  it("readGlobalConfig() rejects economic candidates that reference harness targets", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      canonicalV3GlobalYaml().replace(
        "targetId: codex-terra, comparisonDomainId",
        "targetId: claude-cli, comparisonDomainId",
      ),
    );

    expect(() => readGlobalConfig()).toThrow(
      "managedAgents.economicPolicies[0].candidates[0].targetId must reference a direct target",
    );
  });

  it.each([
    [
      "default target",
      canonicalV3GlobalYaml().replace(
        "defaultTargetId: codex-terra",
        "defaultTargetId: missing-target",
      ),
      "targetRouting.defaultTargetId references an unknown target",
    ],
    [
      "selected target",
      canonicalV3GlobalYaml().replace(
        "targetSelection: { targetId: codex-terra",
        "targetSelection: { targetId: missing-target",
      ),
      "ui.targetSelection.targetId references an unknown target",
    ],
    [
      "default authority profile",
      canonicalV3GlobalYaml().replace(
        "defaultAuthorityProfileId: readonly-scout",
        "defaultAuthorityProfileId: missing-profile",
      ),
      "managedAgents.defaultAuthorityProfileId references an unknown authority profile",
    ],
    [
      "economic target",
      canonicalV3GlobalYaml().replace(
        "targetId: codex-terra, comparisonDomainId",
        "targetId: missing-target, comparisonDomainId",
      ),
      "managedAgents.economicPolicies[0].candidates[0].targetId references an unknown target",
    ],
  ])(
    "readGlobalConfig() rejects an unknown %s reference",
    (_case, yaml, message) => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(yaml);

      expect(() => readGlobalConfig()).toThrow(message);
    },
  );

  it.each([
    ["V1", 'version: "1"', 'Global config version must be "3"'],
    [
      "legacy direct models",
      'version: "3"\ndirectModels: []',
      "Unknown global config field: directModels",
    ],
    [
      "secret",
      'version: "3"\ntargetCatalog: { accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: account, subscriptionClass: subscription, quotaClassId: quota, creditPosture: disabled, overagePosture: disabled }, token: raw-secret }], accountPolicies: [], targets: [] }',
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
        'version: "3"',
        "targetCatalog:",
        "  accounts: [{ id: work, providerId: codex-oauth, credentialId: work, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: work, subscriptionClass: subscription, quotaClassId: quota, creditPosture: disabled, overagePosture: disabled } }]",
        "  accountPolicies: [{ id: work-policy, accountIds: [work], strategy: economic-least-pressure }]",
        `  targets: [{ id: terra, kind: direct, label: Terra, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, dataPolicyEvidence: { providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"c".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }, accountSelection: { mode: automatic, accountPolicyId: work-policy }, economics: { adapterCapabilityId: adapter, adapterCapabilityVersion: v1, authBillingChannel: subscription, executionMode: direct, serviceTier: default, rateCardBasis: subscription, envelopeSemantics: request, fallbackPosture: disabled, overagePosture: disabled, contextClass: standard, cacheClass: none, priceEvidence: { kind: subscription, rateCardId: card, rateCardRevision: v1, evidence: { sourceIdentity: provider, sourceRevision: v1, sourceDigest: digest, observedAt: 2026-01-01T00:00:00Z, validUntil: 2027-01-01T00:00:00Z, confidence: high, authority: configured } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }]`,
        "targetRouting: { defaultTargetId: terra }",
        "ui:",
        "  theme: phosphor",
        "  targetSelection:",
        "    targetId: terra",
        "    accountOverrideId: work",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.ui).toEqual({
      theme: "phosphor",
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
        'version: "3"',
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
      [
        'version: "3"',
        "modelGateway:",
        "  port: 4819",
        "  token: raw-secret",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("Invalid global modelGateway");
  });

  it("readGlobalConfig() rejects non-canonical configs", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "1"', "provider: codex"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'Global config version must be "3". Recreate the canonical config through an explicit adoption flow.',
    );
  });

  it("readGlobalConfig() rejects unknown top-level fields and invalid billing modes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "3"', "provider: codex"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown global config field: provider",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "engines:", "  codex:", "    billing: credits"].join(
        "\n",
      ),
    );
    expect(() => readGlobalConfig()).toThrow(
      "engines.codex.billing has an unknown billing mode",
    );
  });

  it("readGlobalConfig() validates global identity fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "identity:",
        "  name: Alex",
        "  timezone: America/Tijuana",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.identity).toEqual({
      name: "Alex",
      timezone: "America/Tijuana",
    });

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "identity:", "  personality: helpful"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown identity field: personality",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "identity:", '  timezone: ""'].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "identity.timezone must be a non-empty string",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "identity:", "  timezone: Not/A_Timezone"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "identity.timezone must be a valid IANA time zone",
    );
  });

  it("readGlobalConfig() validates active instruction profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "activeInstructionProfiles:",
        "  - sequel-engineering",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.activeInstructionProfiles).toEqual([
      "sequel-engineering",
    ]);

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "activeInstructionProfiles:", '  - ""'].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "activeInstructionProfiles must be an array of non-empty strings",
    );
  });

  it("readGlobalConfig() validates builtin skill policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
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

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "skills:", "  builtin:", "    enabled: yes"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "skills.builtin.enabled must be a boolean",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "skills:", "  selection:", "    mode: eager"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "skills.selection.mode must be advisory or auto",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
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
      [
        'version: "3"',
        "skills:",
        "  visibility:",
        "    overrides:",
        "      planner: sometimes",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "skills.visibility.overrides.planner must be implicit, explicit-only, or disabled",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "skills:",
        "  visibility:",
        "    overrides:",
        "      Planner: disabled",
      ].join("\n"),
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
        'version: "3"',
        "workGovernance:",
        "  defaultPosture: orchestrate",
        "  directExecution:",
        "    maxFiles: 1",
        "    maxRisk: low",
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
      directExecution: {
        maxFiles: 1,
        maxRisk: "low",
      },
      requireDelegationFor: ["architecture", "managed-agents"],
      requiredEvidence: ["surface-map", "residual-risk"],
    });

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "workGovernance:",
        "  requireDelegationFor:",
        "    - vibes",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "workGovernance.requireDelegationFor contains unsupported trigger: vibes",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "workGovernance:",
        "  directExecution:",
        "    maxFiles: 0",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "workGovernance.directExecution.maxFiles must be a positive integer",
    );
  });

  it("rejects unknown or widening bounded-work ceiling fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "workGovernance:",
        "  boundedWorkCeiling:",
        "    unexpected: true",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown workGovernance.boundedWorkCeiling field: unexpected",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "workGovernance:",
        "  boundedWorkCeiling:",
        "    maximumLimits:",
        "      maxExecutionAttempts: 0",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "maximumLimits.maxExecutionAttempts must be a positive safe integer",
    );
  });

  it("readGlobalConfig() accepts web provider defaults", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
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
        'version: "3"',
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
        'version: "3"',
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
        "    admissionProfile: foundation-readonly-plan",
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
        'version: "3"',
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
        "    admissionProfile: foundation-readonly-plan",
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
        'version: "3"',
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

  it("readGlobalConfig() rejects global web authority fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ['version: "3"', "web:", "  enabled: true"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "Unknown global web field: enabled. Put web authority in project .kiln/kiln.yaml.",
    );
  });

  it("readGlobalConfig() rejects invalid target catalog references and account selection", () => {
    existsSyncMock.mockReturnValue(true);
    const valid = [
      'version: "3"',
      "targetCatalog:",
      "  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: account, subscriptionClass: subscription, quotaClassId: quota, creditPosture: disabled, overagePosture: disabled } }]",
      "  accountPolicies: [{ id: policy, accountIds: [account], strategy: economic-least-pressure }]",
      `  targets: [{ id: route, kind: direct, label: Route, providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataClassification: internal, dataPolicyEvidence: { providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"d".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }, accountSelection: { mode: automatic, accountPolicyId: policy }, economics: { adapterCapabilityId: adapter, adapterCapabilityVersion: v1, authBillingChannel: subscription, executionMode: direct, serviceTier: default, rateCardBasis: subscription, envelopeSemantics: request, fallbackPosture: disabled, overagePosture: disabled, contextClass: standard, cacheClass: none, priceEvidence: { kind: subscription, rateCardId: card, rateCardRevision: v1, evidence: { sourceIdentity: provider, sourceRevision: v1, sourceDigest: digest, observedAt: 2026-01-01T00:00:00Z, validUntil: 2027-01-01T00:00:00Z, confidence: high, authority: configured } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }]`,
      "targetRouting: { defaultTargetId: route }",
    ].join("\n");

    readFileSyncMock.mockReturnValue(
      valid.replace("accountPolicyId: policy", "accountPolicyId: missing"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "references an unknown account policy",
    );

    readFileSyncMock.mockReturnValue(
      valid.replaceAll(
        "providerId: codex-oauth, providerModelId",
        "providerId: other-provider, providerModelId",
      ),
    );
    expect(() => readGlobalConfig()).toThrow(
      "provider must match route providerId",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace("defaultTargetId: route", "defaultTargetId: missing"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "targetRouting.defaultTargetId references an unknown target",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace(
        "defaultTargetId: route",
        "defaultTargetId: route, fallbackTargetIds: []",
      ),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown targetRouting field: fallbackTargetIds.",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace("dataClassification: internal, ", ""),
    );
    expect(() => readGlobalConfig()).toThrow(
      "targetCatalog.targets[0].dataClassification is invalid",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace(
        "expiresAt: 2027-01-01T00:00:00Z",
        "expiresAt: 2027-01-01T00:00:00Z, rawPolicy: secret",
      ),
    );
    expect(() => readGlobalConfig()).toThrow(
      "Unknown targetCatalog.targets[0].dataPolicyEvidence field: rawPolicy",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace(
        "providerId: codex-oauth, providerModelId: gpt-5.6-terra, dataUse",
        "providerId: other-provider, providerModelId: gpt-5.6-terra, dataUse",
      ),
    );
    expect(() => readGlobalConfig()).toThrow(
      "dataPolicyEvidence.providerId must match the target providerId",
    );

    readFileSyncMock.mockReturnValue(
      valid.replace("trainingPosture: prohibited", "trainingPosture: permitted"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "may admit only public data when trainingPosture is permitted",
    );
  });

  it("readGlobalConfig() validates model task suitability overrides", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
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
        'version: "3"',
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
        'version: "3"',
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
      [
        'version: "3"',
        "deliberationPolicy:",
        "  byTask:",
        "    frontend-design:",
        "      mode: fixed",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "deliberationPolicy.byTask.frontend-design.preferredLevel is required when mode is fixed",
    );

    readFileSyncMock.mockReturnValue(
      ['version: "3"', "reasoningPolicy:", "  default: medium"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "Unknown global config field: reasoningPolicy",
    );
  });

  it("readGlobalConfig() validates authority profile write authority shape", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "authorityProfiles:",
        "  - id: approved-write",
        "    admissionProfile: foundation-apply-approved-writes",
        "    writeAuthority:",
        "      workspace:",
        "        mode: apply-approved",
        "        allowedPaths:",
        "          - packages/cli/src/config",
        "      approval:",
        "        mode: required-before-apply",
      ].join("\n"),
    );

    expect(
      readGlobalConfig()?.authorityProfiles?.[0]?.writeAuthority,
    ).toMatchObject({
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
        'version: "3"',
        "authorityProfiles:",
        "  - id: approved-write",
        "    admissionProfile: foundation-apply-approved-writes",
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
        'version: "3"',
        "managedAgents:",
        "  enabled: true",
        "  worktreeLease:",
        "    mode: git",
        "    rootPath: .kiln/managed-worktrees",
        "    ref: HEAD",
        "authorityProfiles:",
        "  - id: approved-write",
        "    admissionProfile: foundation-apply-approved-writes",
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
        'version: "3"',
        "authorityProfiles:",
        "  - id: sandbox-readonly",
        "    admissionProfile: foundation-readonly-plan",
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
        'version: "3"',
        "targetCatalog:",
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        `      dataPolicyEvidence: { providerId: codex-cloud, providerModelId: gpt-5.5, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"d".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }`,
        "      remoteHarness:",
        "        invokeUrl: https://remote.example.test/managed-agent/invoke",
        "        cancelUrl: https://remote.example.test/managed-agent/cancel",
        "        authTokenEnv: KILN_REMOTE_HARNESS_TOKEN",
        "        limitations:",
        "          - Remote harness reports aggregate token classes only.",
      ].join("\n"),
    );

    expect(
      readGlobalConfig()?.targetCatalog?.targets[0]?.remoteHarness,
    ).toEqual({
      invokeUrl: "https://remote.example.test/managed-agent/invoke",
      cancelUrl: "https://remote.example.test/managed-agent/cancel",
      authTokenEnv: "KILN_REMOTE_HARNESS_TOKEN",
      limitations: ["Remote harness reports aggregate token classes only."],
    });

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "targetCatalog:",
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        `      dataPolicyEvidence: { providerId: codex-cloud, providerModelId: gpt-5.5, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"d".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }`,
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
        'version: "3"',
        "targetCatalog:",
        "  accounts: []",
        "  accountPolicies: []",
        "  targets:",
        "    - id: codex-cloud",
        "      kind: harness",
        "      label: Codex Cloud",
        "      providerId: codex-cloud",
        "      providerModelId: gpt-5.5",
        "      dataClassification: internal",
        `      dataPolicyEvidence: { providerId: codex-cloud, providerModelId: gpt-5.5, dataUse: not-used, trainingPosture: prohibited, retention: { posture: zero, days: 0 }, permittedMaximumClassification: internal, permittedClassifications: [public, internal], sourceIdentity: fixture-privacy, sourceRevision: rev-1, sourceDigest: sha256:${"d".repeat(64)}, observedAt: 2026-01-01T00:00:00Z, expiresAt: 2027-01-01T00:00:00Z }`,
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
        'version: "3"',
        "managedAgents:",
        "  worktreeLease:",
        "    mode: shell",
        "    rootPath: .kiln/managed-worktrees",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      'managedAgents.worktreeLease.mode must be "git"',
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "managedAgents:",
        "  worktreeLease:",
        "    mode: git",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "managedAgents.worktreeLease.rootPath is required",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "authorityProfiles:",
        "  - id: invalid-workdir",
        "    admissionProfile: foundation-readonly-plan",
        "    workingDirectory: shared-checkout",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "authorityProfiles[0].workingDirectory is invalid",
    );

    readFileSyncMock.mockReturnValue(
      [
        'version: "3"',
        "managedAgents:",
        "  worktreeLease:",
        "    mode: git",
        "    rootPath: .kiln/managed-worktrees",
        "    gitBianary: git",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "Unknown managedAgents.worktreeLease field: gitBianary",
    );
  });

  it("readGlobalConfig() rejects unknown authority-profile tool fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      'version: "3"',
      "authorityProfiles:",
      "  - id: readonly-scout",
      "    admissionProfile: foundation-readonly-plan",
      "    tools: { allowed: [resource_read], shell: true }",
    ].join("\n"));

    expect(() => readGlobalConfig()).toThrow(
      "Unknown authorityProfiles[0].tools field: shell",
    );
  });

  it("readGlobalConfig() rejects unsupported authority-profile memory access", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      'version: "3"',
      "authorityProfiles:",
      "  - id: readonly-scout",
      "    admissionProfile: foundation-readonly-plan",
      "    memory: { access: unrestricted }",
    ].join("\n"));

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

  it("mutateGlobalConfig() atomically replaces on Windows without unlinking the destination", () => {
    existsSyncMock.mockImplementation((path: string) =>
      String(path).endsWith("config.yaml"),
    );
    readFileSyncMock.mockReturnValue('version: "3"\nui:\n  theme: phosphor\n');
    statSyncMock.mockReturnValue({ mode: 0o100640 });

    const result = mutateGlobalConfig((current) => ({
      ...(current ?? defaultGlobalConfig()),
      ui: { theme: "vesper" },
    }));

    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    const temporaryPath = renameSyncMock.mock.calls[0]?.[0] as string;
    expect(temporaryPath).toMatch(
      new RegExp(
        `${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f-]+\\.tmp$`,
        "i",
      ),
    );
    expect(mkdirSyncMock).toHaveBeenCalledWith(
      join("/home/test-user", ".kiln"),
      { recursive: true },
    );
    expect(openSyncMock).toHaveBeenCalledWith(lockPath, "wx", 0o600);
    expect(openSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      readFileSyncMock.mock.invocationCallOrder[0]!,
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      temporaryPath,
      expect.stringContaining("theme: vesper"),
      {
        encoding: "utf-8",
        mode: 0o640,
      },
    );
    expect(chmodSyncMock).toHaveBeenCalledWith(temporaryPath, 0o640);
    expect(renameSyncMock).toHaveBeenCalledWith(temporaryPath, configPath);
    expect(rmSyncMock).not.toHaveBeenCalledWith(configPath, expect.anything());
    expect(rmSyncMock).toHaveBeenCalledWith(temporaryPath, { force: true });
    const releasePath = renameSyncMock.mock.calls.find(
      ([from]) => from === lockPath,
    )?.[1] as string;
    expect(releasePath).toMatch(/\.lock\.release-[0-9a-f-]+$/i);
    expect(closeSyncMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      rmSyncMock.mock.invocationCallOrder.at(-1)!,
    );
    expect(rmSyncMock).toHaveBeenCalledWith(releasePath, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
    expect(result.previousRevision).toMatch(/^sha256:/);
    expect(result.revision).toMatch(/^sha256:/);
    expect(result.revision).not.toBe(result.previousRevision);
  });

  it("mutateGlobalConfig() returns deterministic revision conflict evidence without invoking the mutation", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('version: "3"\n');
    const mutation = vi.fn((current) => current ?? defaultGlobalConfig());

    expect(() =>
      mutateGlobalConfig(mutation, { expectedRevision: "sha256:stale" }),
    ).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_REVISION_CONFLICT",
        evidence: expect.objectContaining({ expectedRevision: "sha256:stale" }),
      }),
    );
    expect(mutation).not.toHaveBeenCalled();
    expect(
      writeFileSyncMock.mock.calls.some(([path]) => typeof path === "string"),
    ).toBe(false);
    expect(rmSyncMock).not.toHaveBeenCalledWith(
      `${join("/home/test-user", ".kiln", "config.yaml")}.lock`,
      { force: true },
    );
  });

  it("mutateGlobalConfig() preserves revision and avoids replacement for a semantic no-op", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('version: "3"\nui:\n  theme: phosphor\n');

    const result = mutateGlobalConfig((current) => ({ ...current! }));

    expect(result.revision).toBe(result.previousRevision);
    expect(
      renameSyncMock.mock.calls.some(
        ([, destination]) =>
          destination === join("/home/test-user", ".kiln", "config.yaml"),
      ),
    ).toBe(false);
    expect(
      writeFileSyncMock.mock.calls.some(([path]) => typeof path === "string"),
    ).toBe(false);
  });

  it("mutateGlobalConfig() cannot delete a successor lock acquired after its atomic release claim", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('version: "3"\n');
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    let successorAcquired = false;
    renameSyncMock.mockImplementation((from: string, destination: string) => {
      if (from === lockPath && destination.includes(".release-"))
        successorAcquired = true;
    });
    rmSyncMock.mockImplementation((path: string) => {
      if (successorAcquired && path === lockPath)
        throw new Error("successor lock was deleted");
    });

    expect(() => mutateGlobalConfig((current) => current!)).not.toThrow();

    expect(successorAcquired).toBe(true);
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
    expect(rmSyncMock).toHaveBeenCalledWith(
      expect.stringContaining(".lock.release-"),
      { force: true },
    );
  });

  it("mutateGlobalConfig() ownership-safely claims a partially initialized lock before cleanup", () => {
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    const lockPath = `${configPath}.lock`;
    fsyncSyncMock.mockImplementation(() => {
      throw new Error("lock fsync failed");
    });

    expect(() => mutateGlobalConfig(() => defaultGlobalConfig())).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );

    const releasePath = renameSyncMock.mock.calls.find(
      ([from]) => from === lockPath,
    )?.[1] as string;
    expect(releasePath).toMatch(/\.lock\.release-[0-9a-f-]+$/i);
    expect(renameSyncMock).toHaveBeenCalledWith(lockPath, releasePath);
    expect(closeSyncMock).toHaveBeenCalledWith(7);
    expect(rmSyncMock).toHaveBeenCalledWith(releasePath, { force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(lockPath, { force: true });
  });

  it("mutateGlobalConfig() reports lock contention and does not read or write config", () => {
    openSyncMock.mockImplementation(() => {
      const error = new Error("exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });

    expect(() => mutateGlobalConfig(() => defaultGlobalConfig())).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );
    expect(readFileSyncMock).toHaveBeenCalledWith(
      `${join("/home/test-user", ".kiln", "config.yaml")}.lock`,
      "utf-8",
    );
    expect(
      readFileSyncMock.mock.calls.some(
        ([path]) => path === join("/home/test-user", ".kiln", "config.yaml"),
      ),
    ).toBe(false);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(rmSyncMock).not.toHaveBeenCalled();
  });

  it("mutateGlobalConfig() cleans its temporary and lock files when atomic replacement fails", () => {
    existsSyncMock.mockReturnValue(false);
    renameSyncMock.mockImplementation((from: string) => {
      if (from.endsWith(".tmp")) throw new Error("replace failed");
    });

    expect(() => mutateGlobalConfig(() => defaultGlobalConfig())).toThrow(
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

  it("mutateGlobalConfig() recovers a dead owner's lock and its exact temporary file", () => {
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
      return 'version: "3"\n';
    });
    existsSyncMock.mockReturnValue(false);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("not found") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });

    mutateGlobalConfig(() => defaultGlobalConfig());

    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    expect(kill).toHaveBeenCalledWith(424242, 0);
    expect(rmSyncMock).toHaveBeenCalledWith(
      `${configPath}.${staleAcquisitionId}.tmp`,
      { force: true },
    );
    expect(renameSyncMock).toHaveBeenCalledWith(
      `${configPath}.lock`,
      expect.stringMatching(/\.lock\.recovery-[0-9a-f-]+$/i),
    );
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.lock`, {
      force: true,
    });
    expect(openSyncMock).toHaveBeenCalledTimes(2);
  });

  it("mutateGlobalConfig() does not clean a stale lock claimed first by a competing recoverer", () => {
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

    expect(() => mutateGlobalConfig(() => defaultGlobalConfig())).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }),
    );
    const configPath = join("/home/test-user", ".kiln", "config.yaml");
    expect(rmSyncMock).not.toHaveBeenCalledWith(
      `${configPath}.${staleAcquisitionId}.tmp`,
      { force: true },
    );
    expect(rmSyncMock).not.toHaveBeenCalledWith(`${configPath}.lock`, {
      force: true,
    });
  });

  it("mutateGlobalConfig() backs up invalid bytes while holding the lock before replacement", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("invalid: [\n");
    statSyncMock.mockReturnValue({ mode: 0o100600 });

    const result = mutateGlobalConfig(() => defaultGlobalConfig(), {
      invalidCurrent: "backup-and-replace",
    });

    expect(result.invalidBackupPath).toMatch(
      /config\.yaml\.invalid-[0-9a-f-]+\.bak$/i,
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      result.invalidBackupPath,
      "invalid: [\n",
      { encoding: "utf-8", flag: "wx", mode: 0o600 },
    );
    const backupOrder = writeFileSyncMock.mock.invocationCallOrder[1]!;
    expect(openSyncMock.mock.invocationCallOrder[0]).toBeLessThan(backupOrder);
    expect(backupOrder).toBeLessThan(
      renameSyncMock.mock.invocationCallOrder[0]!,
    );
  });

  it("mutateGlobalConfig() fails closed when lock owner liveness is unknown", () => {
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

    expect(() => mutateGlobalConfig(() => defaultGlobalConfig())).toThrow(
      expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
        evidence: expect.objectContaining({ lockOwnerPid: 424242 }),
      }),
    );
    expect(renameSyncMock).not.toHaveBeenCalled();
  });

  it("defaultGlobalConfig() returns expected shape", () => {
    expect(defaultGlobalConfig()).toEqual({
      version: "3",
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
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: [
          "architecture",
          "security",
          "ui",
          "runtime",
          "provider-routing",
          "managed-agents",
          "config",
          "multi-file",
          "cross-surface",
          "long-running",
          "verification-heavy",
          "formal-proof-candidate",
        ],
        requiredEvidence: [
          "surface-map",
          "risk-hypothesis",
          "plan",
          "tests",
          "typecheck",
          "residual-risk",
        ],
      },
      components: {
        include: ["baseline:core"],
      },
    });
  });

  it("resolves provider, model, and UI theme through projection helpers", () => {
    const config = {
      version: "3" as const,
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
            accountSelection: {
              mode: "automatic" as const,
              accountPolicyId: "policy",
            },
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
      ui: { theme: "vesper" },
    };

    expect(resolveGlobalDefaultProvider(config)).toBe("codex-oauth");
    expect(resolveGlobalDefaultModel(config)).toBe("gpt-5.6-terra");
    expect(resolveGlobalUiTheme(config)).toBe("vesper");
  });
});
