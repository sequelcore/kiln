import { describe, expect, it } from "vitest";
import { RUNNING_CLI_VERSION } from "../../src/build-identity.js";
import {
  CANONICAL_GLOBAL_CONFIG_VERSION,
  validateGlobalConfig,
  type KilnGlobalConfig,
} from "../../src/config/global-config.js";

function baseConfig(): KilnGlobalConfig {
  return { version: CANONICAL_GLOBAL_CONFIG_VERSION };
}

describe("validateGlobalConfig root fields", () => {
  it("accepts a versioned reviewed Codex external catalog policy and rejects ambiguous decisions", () => {
    const decision = { sourceId: "plugin:docs:pdf:.", packageDigest: `sha256:${"a".repeat(64)}` };
    const expectedFingerprint = `sha256:${"b".repeat(64)}`;
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      skills: { externalCatalog: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [decision] } } } },
    })).not.toThrow();
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      skills: { externalCatalog: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [decision, decision] } } } },
    })).toThrow(/Duplicate external catalog sourceId/u);
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      skills: { externalCatalog: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [{ ...decision, packageDigest: "sha256:bad" }] } } } },
    })).toThrow(/packageDigest/u);
  });

  it("accepts deliberationPolicy", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      deliberationPolicy: {
        default: { mode: "provider-default", onUnsupported: "omit" },
      },
    })).not.toThrow();
  });

  it("rejects a field absent from the schema", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      notARealField: true,
    })).toThrow(/Unknown global config field: notARealField/);
  });

  it("rejects retired root routing and models fields", () => {
    expect(() => validateGlobalConfig({ ...baseConfig(), routing: {} })).toThrow(/Unknown global config field: routing/u);
    expect(() => validateGlobalConfig({ ...baseConfig(), models: {} })).toThrow(/Unknown global config field: models/u);
  });

  it("rejects retired worker routing and model catalogs", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      workerRouting: { defaultWorker: "codex" },
    })).toThrow(/Unknown global config field: workerRouting/u);
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      workerModels: { codex: "gpt-5.6-terra" },
    })).toThrow(/Unknown global config field: workerModels/u);
  });
});

describe("unknown-field diagnostics identify the running build", () => {
  it("names the running version so build drift is distinguishable from a config error", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      notARealField: true,
    })).toThrow(new RegExp(`Validated by kiln ${RUNNING_CLI_VERSION.replace(/\./gu, "\\.")}`, "u"));
  });

  it("states that the running build may predate the field", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      notARealField: true,
    })).toThrow(/the running build predates it/u);
  });

  it("applies to nested field sets", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      identity: { notARealField: true },
    })).toThrow(/Unknown identity field: notARealField\. Validated by kiln /u);

    expect(() => validateGlobalConfig({
      ...baseConfig(),
      ui: { notARealField: true },
    })).toThrow(/Unknown ui field: notARealField\. Validated by kiln /u);
  });

  it("preserves field-specific guidance alongside the build identity", () => {
    expect(() => validateGlobalConfig({
      ...baseConfig(),
      web: { notARealField: true },
    })).toThrow(
      /Unknown global web field: notARealField\. Put web authority in project \.kiln\/kiln\.yaml\. Validated by kiln /u,
    );
  });
});
