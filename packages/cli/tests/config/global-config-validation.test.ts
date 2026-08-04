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
    })).toThrow(/Unknown global ui field: notARealField\. Validated by kiln /u);
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
