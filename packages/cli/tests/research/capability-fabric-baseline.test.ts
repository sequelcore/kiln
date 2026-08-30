import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { discoverHarnessCompatibilityCapabilities } from "@kilnai/core/capabilities";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const baselineRoot = resolve(
  repositoryRoot,
  "docs/research/fixtures/capability-fabric/v1",
);
const COMPATIBILITY_EVALUATED_AT = "2026-08-29T12:00:00.000Z";
const COMPATIBILITY_OBSERVED_AT = "2026-08-29T11:00:00.000Z";
const COMPATIBILITY_VALID_UNTIL = "2026-08-29T13:00:00.000Z";

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateJsonSchema(value: unknown, schema: JsonObject, path = "record"): void {
  if (schema.const !== undefined) expect(value, path).toEqual(schema.const);
  if (schema.enum !== undefined) expect(schema.enum as unknown[], path).toContain(value);
  if (schema.type === "string") {
    expect(typeof value, path).toBe("string");
    if (schema.pattern) expect(value as string, path).toMatch(new RegExp(schema.pattern as string));
    if (schema.format === "date") expect(value as string, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (schema.format === "uri") expect(() => new URL(value as string), path).not.toThrow();
  }
  if (schema.type === "boolean") expect(typeof value, path).toBe("boolean");
  if (schema.type === "array") {
    expect(Array.isArray(value), path).toBe(true);
    const items = value as unknown[];
    if (schema.minItems !== undefined) {
      expect(items.length, path).toBeGreaterThanOrEqual(schema.minItems as number);
    }
    if (schema.items) {
      items.forEach((item, index) =>
        validateJsonSchema(item, schema.items as JsonObject, `${path}[${index}]`),
      );
    }
  }
  if (schema.type === "object") {
    expect(value !== null && typeof value === "object" && !Array.isArray(value), path).toBe(true);
    const object = value as JsonObject;
    const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
    for (const required of (schema.required ?? []) as string[]) {
      expect(Object.hasOwn(object, required), `${path}.${required}`).toBe(true);
    }
    if (schema.additionalProperties === false) {
      expect(Object.keys(object).filter((key) => !(key in properties)), path).toEqual([]);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(object, key)) validateJsonSchema(object[key], childSchema, `${path}.${key}`);
    }
  }
}

describe("capability-fabric compatibility baseline", () => {
  it("freezes one valid, secret-free compatibility record per admitted harness", async () => {
    const schema = await readJson(resolve(baselineRoot, "compatibility-record.schema.json"));
    expect(schema.$id).toBe("https://kiln.ai/schemas/capability-compatibility/v1");

    const recordFiles = ["codex.json", "claude.json", "opencode-v2.json"];
    const records = await Promise.all(
      recordFiles.map((file) => readJson(resolve(baselineRoot, "records", file))),
    );

    for (const record of records) validateJsonSchema(record, schema);

    expect(records.map((record) => record.harness)).toEqual([
      "codex",
      "claude",
      "opencode-v2",
    ]);

    for (const record of records) {
      expect(record.schema).toBe("kiln.capability-compatibility/v1");
      expect(record.sdk).toMatchObject({
        package: expect.stringMatching(/^@/),
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        npmIntegrity: expect.stringMatching(/^sha512-/),
      });
      expect(record.runtime).toMatchObject({
        observedVersion: expect.any(String),
        observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      expect(record.source).toMatchObject({
        repository: expect.stringMatching(/^https:\/\/github\.com\//),
        tag: expect.any(String),
        commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      });

      const artifacts = record.sourceArtifacts as JsonObject[];
      expect(artifacts.length).toBeGreaterThan(0);
      const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
      expect(artifactIds.size).toBe(artifacts.length);
      for (const artifact of artifacts) {
        expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      }

      const capabilities = record.capabilities as JsonObject[];
      expect(capabilities.length).toBeGreaterThan(0);
      expect(new Set(capabilities.map((capability) => capability.id)).size).toBe(
        capabilities.length,
      );
      for (const capability of capabilities) {
        expect([
          "portable-function/mcp",
          "hosted-provider",
          "harness-private",
          "lossy/unrepresentable",
        ]).toContain(capability.classification);
        expect(["lossless", "lossy", "unrepresentable"]).toContain(
          capability.representation,
        );
        expect(capability.sourceArtifacts).toEqual(expect.any(Array));
        for (const artifactId of capability.sourceArtifacts as string[]) {
          expect(artifactIds.has(artifactId)).toBe(true);
        }
        if (capability.stability === "experimental") {
          expect(capability.eligible).toBe(false);
        }
      }

      const fixture = record.fixture as JsonObject;
      const fixtureText = await readFile(resolve(baselineRoot, fixture.path as string), "utf8");
      expect(sha256(fixtureText)).toBe(fixture.sha256);

      const liveEvidence = record.liveEvidence as JsonObject[];
      expect(liveEvidence.length).toBeGreaterThan(0);
      for (const evidence of liveEvidence) {
        expect(["observed", "failed", "not-run"]).toContain(evidence.status);
        expect(evidence.command).toEqual(expect.any(String));
        expect(evidence.bound).toEqual(expect.any(String));
      }
      expect(
        liveEvidence.filter((evidence) => evidence.status === "failed"),
        `${record.harness as string} retains failed baseline evidence`,
      ).toEqual([]);
      expect(
        liveEvidence.some((evidence) =>
          evidence.status === "observed"
          && typeof evidence.scope === "string"
          && evidence.scope.startsWith("provider-"),
        ),
        `${record.harness as string} has no bounded provider observation`,
      ).toBe(true);

      expect(JSON.stringify(record)).not.toMatch(
        /(?:bearer\s+|api[_-]?key|access[_-]?token|C:\\Users\\)/i,
      );
    }
  });

  it("projects each exact record through the inert decision-only Core adapter", async () => {
    const recordFiles = ["codex.json", "claude.json", "opencode-v2.json"];

    for (const file of recordFiles) {
      const recordPath = resolve(baselineRoot, "records", file);
      const recordBytes = await readFile(recordPath);
      const record = JSON.parse(recordBytes.toString("utf8")) as JsonObject;
      const fixture = record.fixture as JsonObject;
      const fixtureBytes = await readFile(resolve(baselineRoot, fixture.path as string));
      const snapshot = {
        ...record,
        recordDigest: `sha256:${sha256(recordBytes)}`,
        fixtureDigest: `sha256:${sha256(fixtureBytes)}`,
        completeness: "complete",
        invalidated: false,
        freshness: {
          observedAt: COMPATIBILITY_OBSERVED_AT,
          validUntil: COMPATIBILITY_VALID_UNTIL,
          status: "current",
        },
      };

      const result = discoverHarnessCompatibilityCapabilities({
        evaluatedAt: COMPATIBILITY_EVALUATED_AT,
        snapshot,
      });
      const capabilities = record.capabilities as JsonObject[];
      const decisions = result.catalog.decisions;
      const diagnosticCodes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));

      expect(result.candidates).toEqual([]);
      expect(result.catalog.descriptors).toEqual([]);
      expect(decisions).toHaveLength(capabilities.length);
      expect(decisions.every((decision) => decision.status === "ineligible")).toBe(true);
      for (const capability of capabilities) {
        expect(decisions).toEqual(expect.arrayContaining([
          expect.objectContaining({
            capabilityId: capability.id,
            status: "ineligible",
          }),
        ]));
      }

      if (capabilities.some((capability) => capability.eligible === true && capability.stability !== "experimental")) {
        expect(diagnosticCodes.has("native_route_deferred")).toBe(true);
      }
      if (capabilities.some((capability) => capability.eligible === false)) {
        expect(diagnosticCodes.has("source_declared_ineligible")).toBe(true);
      }
      if (capabilities.some((capability) => capability.stability === "experimental")) {
        expect(diagnosticCodes.has("experimental_contract")).toBe(true);
      }

      const projected = JSON.stringify(result);
      for (const artifact of record.sourceArtifacts as JsonObject[]) {
        expect(projected).not.toContain(artifact.path as string);
      }
      expect(projected).not.toContain(fixture.path as string);
      expect(projected).not.toMatch(/(?:bearer\s+|api[_-]?key|access[_-]?token|C:\\Users\\)/i);
    }
  });

  it("keeps experimental OpenCode discovery explicitly ineligible", async () => {
    const record = await readJson(resolve(baselineRoot, "records/opencode-v2.json"));
    const capabilities = record.capabilities as JsonObject[];
    const discovery = capabilities.find(
      (capability) => capability.id === "opencode.experimental-tool-discovery",
    );

    expect(discovery).toMatchObject({
      classification: "lossy/unrepresentable",
      stability: "experimental",
      eligible: false,
    });
    expect(discovery?.endpoints).toEqual([
      "/experimental/tool",
      "/experimental/tool/ids",
    ]);
  });

  it("binds the records to the exact package pins", async () => {
    const packageJson = await readJson(resolve(repositoryRoot, "packages/cli/package.json"));
    const runtimePackageJson = await readJson(resolve(repositoryRoot, "packages/runtime/package.json"));
    const dependencies = packageJson.dependencies as JsonObject;
    const runtimeDependencies = runtimePackageJson.dependencies as JsonObject;
    const lockfile = await readFile(resolve(repositoryRoot, "bun.lock"), "utf8");
    const expected = {
      codex: ["@openai/codex-sdk", "0.147.0"],
      claude: ["@anthropic-ai/claude-agent-sdk", "0.3.237"],
      "opencode-v2": ["@opencode-ai/sdk", "1.18.18"],
    } as const;

    for (const [harness, [packageName, version]] of Object.entries(expected)) {
      const record = await readJson(resolve(baselineRoot, `records/${harness}.json`));
      expect(dependencies[packageName]).toBe(version);
      expect(record.sdk).toMatchObject({ package: packageName, version });
      const sdk = record.sdk as JsonObject;
      expect(lockfile).toContain(`"${packageName}@${version}"`);
      expect(lockfile).toContain(sdk.npmIntegrity as string);
    }

    expect(runtimeDependencies["@anthropic-ai/claude-agent-sdk"]).toBe("0.3.237");
  });
});
