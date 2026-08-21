import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RUNNING_CLI_VERSION, resolveRunningCliModulePath } from "../../src/build-identity.js";
import { buildHarnessDoctorReport, type HarnessDoctorModelDiscovery } from "../../src/application/harness-doctor.js";
import {
  CANONICAL_GLOBAL_CONFIG_VERSION,
  validateGlobalConfig,
} from "../../src/config/global-config.js";

const globalDocument = `version: "${CANONICAL_GLOBAL_CONFIG_VERSION}"
deliberationPolicy:
  default:
    mode: provider-default
    onUnsupported: omit
`;

function validateDocument(document: string): void {
  validateGlobalConfig(parse(document));
}

function diagnosticFor(document: string): string {
  try {
    validateDocument(document);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("Expected the global document to be rejected.");
}

function createDiscovery(): HarnessDoctorModelDiscovery {
  const provider = {
    models: [],
    status: "unavailable",
    reason: "fixture",
    authState: "unknown",
  };
  return {
    claudeModels: [],
    claudeDiscovery: provider,
    codexModels: [],
    codexDiscovery: provider,
    opencodeModels: [],
    opencodeDiscovery: provider,
  };
}

describe("ADR-012 global config compatibility", () => {
  it("accepts an additive optional field without treating the matching version as a feature signal", () => {
    const document = parse(globalDocument);

    expect(document.version).toBe(CANONICAL_GLOBAL_CONFIG_VERSION);
    expect(() => validateGlobalConfig(document)).not.toThrow();
    expect(() => validateDocument(`${globalDocument}futureField: true\n`)).toThrow(
      /Unknown global config field: futureField/u,
    );
  });

  it("emits one stable unknown-field diagnostic with running version and resolved module path", () => {
    const message = diagnosticFor(`${globalDocument}futureField: true\n`);
    const modulePath = resolveRunningCliModulePath();

    expect(message).toBe(
      `Unknown global config field: futureField. Validated by kiln ${RUNNING_CLI_VERSION} at ${modulePath};`
        + " if this field exists at HEAD, the running build predates it.",
    );
    expect(message.match(/Validated by kiln/gu)).toHaveLength(1);
  });

  it.each([
    {
      name: "linked checkout source",
      runningModulePath: win32.join("C:\\fixture", "kiln", "packages", "cli", "src", "build-identity.ts"),
      expected: "linked-to-checkout",
    },
    {
      name: "stale detached dist",
      runningModulePath: "C:\\Users\\Fixture\\.bun\\install\\global\\node_modules\\@kilnai\\cli\\dist\\build-identity.js",
      expected: "detached-from-checkout",
    },
    {
      name: "rebuilt checkout dist",
      runningModulePath: win32.join("C:\\fixture", "kiln", "packages", "cli", "dist", "build-identity.js"),
      expected: "linked-to-checkout",
    },
  ] as const)("reports the doctor linkage verdict for $name", async ({ runningModulePath, expected }) => {
    const checkout = win32.join("C:\\fixture", "kiln");
    const report = await buildHarnessDoctorReport({
      env: { PATH: "" },
      platform: "win32",
      projectRoot: checkout,
      runningModulePath,
      fileExists: () => false,
      discoverModels: async () => createDiscovery(),
      readConfigProjections: async () => [],
      readPackageName: (manifestPath) =>
        manifestPath === win32.join(checkout, "packages", "cli", "package.json")
          ? "@kilnai/cli"
          : undefined,
    });

    expect(report.kilnCli.sourceLinkage).toBe(expected);
    if (expected === "detached-from-checkout") {
      expect(report.kilnCli.warnings).toContainEqual(expect.stringContaining("outside this kiln checkout"));
      expect(report.kilnCli.repairActions).toContainEqual(expect.stringContaining("bun link"));
    } else {
      expect(report.kilnCli.warnings).toEqual([]);
      expect(report.kilnCli.repairActions).toEqual([]);
    }
  });
});
