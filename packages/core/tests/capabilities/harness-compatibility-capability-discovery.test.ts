import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { discoverHarnessCompatibilityCapabilities } from "../../src/capabilities/harness-compatibility-capability-discovery.js";

const EVALUATED_AT = "2026-08-29T12:00:00.000Z";
const OBSERVED_AT = "2026-08-29T11:00:00.000Z";
const VALID_UNTIL = "2026-08-29T13:00:00.000Z";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ARTIFACT_DIGEST = "a".repeat(64);
const FIXTURE_DIGEST = "b".repeat(64);

type Harness = "codex" | "claude" | "opencode-v2";
type CompatibilityRecord = ReturnType<typeof compatibilityRecord>;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compatibilityRecord(
  harness: Harness,
  capabilities: readonly Record<string, unknown>[],
): {
  schema: "kiln.capability-compatibility/v1";
  harness: Harness;
  sdk: { package: string; version: string; npmIntegrity: string };
  runtime: { name: string; observedVersion: string; observedAt: string; relationshipToSdk: string };
  source: { repository: string; tag: string; commit: string };
  sourceArtifacts: readonly Record<string, unknown>[];
  capabilities: readonly Record<string, unknown>[];
  fixture: { path: string; sha256: string; kind: "synthetic" };
  liveEvidence: readonly Record<string, unknown>[];
} {
  const sdk = {
    codex: { package: "@openai/codex-sdk", version: "0.147.0" },
    claude: { package: "@anthropic-ai/claude-agent-sdk", version: "0.3.237" },
    "opencode-v2": { package: "@opencode-ai/sdk", version: "1.18.18" },
  }[harness];
  const source = {
    codex: { repository: "https://github.com/openai/codex", tag: "rust-v0.147.0" },
    claude: { repository: "https://github.com/anthropics/claude-agent-sdk-typescript", tag: "v0.3.237" },
    "opencode-v2": { repository: "https://github.com/anomalyco/opencode", tag: "v1.18.18" },
  }[harness];

  return {
    schema: "kiln.capability-compatibility/v1",
    harness,
    sdk: { ...sdk, npmIntegrity: `sha512-${"A".repeat(86)}==` },
    runtime: {
      name: harness === "opencode-v2" ? "opencode" : harness,
      observedVersion: harness === "claude" ? "2.1.229" : harness === "opencode-v2" ? "1.18.16" : "0.147.0",
      observedAt: "2026-08-14",
      relationshipToSdk: "The runtime observation is retained separately from SDK evidence.",
    },
    source: { ...source, commit: COMMIT },
    sourceArtifacts: [{
      id: "sdk-contract",
      origin: "official-repository",
      path: "sdk/types.ts",
      sha256: ARTIFACT_DIGEST,
      supports: "The exact released harness contract.",
    }],
    capabilities,
    fixture: { path: `fixtures/${harness}-events.json`, sha256: FIXTURE_DIGEST, kind: "synthetic" },
    liveEvidence: [{
      scope: "provider-read-only-capability",
      command: "synthetic-harness-observation",
      bound: "one bounded synthetic observation",
      status: "observed",
      result: "synthetic result",
    }],
  };
}

function declaration(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    classification: "portable-function/mcp",
    stability: "stable",
    eligible: true,
    representation: "lossless",
    semanticLoss: [],
    sourceArtifacts: ["sdk-contract"],
    ...overrides,
  };
}

function snapshot(
  record: CompatibilityRecord,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const recordDigest = typeof overrides.recordDigest === "string"
    ? overrides.recordDigest
    : digest(JSON.stringify(record));
  return {
    ...record,
    recordDigest,
    fixtureDigest: record.fixture.sha256,
    completeness: "complete",
    invalidated: false,
    freshness: {
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      status: "current",
    },
    ...overrides,
  };
}

function discover(
  record: CompatibilityRecord,
  overrides: Record<string, unknown> = {},
): ReturnType<typeof discoverHarnessCompatibilityCapabilities> {
  return discoverHarnessCompatibilityCapabilities({
    evaluatedAt: EVALUATED_AT,
    snapshot: snapshot(record, overrides),
  });
}

function codes(result: ReturnType<typeof discoverHarnessCompatibilityCapabilities>): readonly string[] {
  return result.diagnostics.map((entry) => entry.code);
}

function reflectionTrapHandler(counter: { count: number }): ProxyHandler<object> {
  return {
    getPrototypeOf() {
      counter.count += 1;
      throw new Error("getPrototypeOf must not execute");
    },
    ownKeys() {
      counter.count += 1;
      throw new Error("ownKeys must not execute");
    },
    getOwnPropertyDescriptor() {
      counter.count += 1;
      throw new Error("getOwnPropertyDescriptor must not execute");
    },
  };
}

function recordsWithOneDeclaration(): readonly CompatibilityRecord[] {
  return (["codex", "claude", "opencode-v2"] as const).map((harness) =>
    compatibilityRecord(harness, [declaration(`${harness}.portable-tool`)]),
  );
}

describe("harness compatibility capability discovery", () => {
  it("keeps all three exact harness records decision-only and ineligible", () => {
    for (const record of recordsWithOneDeclaration()) {
      const result = discover(record);

      expect(result.candidates).toEqual([]);
      expect(result.catalog.descriptors).toEqual([]);
      expect(result.catalog.decisions).toHaveLength(record.capabilities.length);
      expect(result.catalog.decisions.every((decision) => decision.status === "ineligible")).toBe(true);
      expect(result.catalog.decisions.every((decision) => decision.capabilityId !== undefined)).toBe(true);
      expect(codes(result)).toContain("native_route_deferred");
      expect(JSON.stringify(result)).not.toContain("sdk/types.ts");
      expect(JSON.stringify(result)).not.toContain("fixtures/");
    }
  });

  it("normalizes declaration order deterministically without creating descriptors", () => {
    const record = compatibilityRecord("codex", [
      declaration("codex.z-tool"),
      declaration("codex.a-tool", { semanticLoss: ["The native result is not portable."] }),
    ]);
    const reversed = { ...record, capabilities: [...record.capabilities].reverse() };

    const recordDigest = digest(JSON.stringify(record));
    const first = discover(record, { recordDigest });
    const second = discover(reversed, { recordDigest });

    expect(first).toEqual(second);
    expect(first.catalog.descriptors).toEqual([]);
    expect(first.catalog.decisions.map((decision) => decision.capabilityId)).toEqual([
      "codex.a-tool",
      "codex.z-tool",
    ]);
    expect(codes(first)).toContain("native_route_deferred");
  });

  it("distinguishes source ineligibility and experimental contracts", () => {
    const record = compatibilityRecord("opencode-v2", [
      declaration("opencode-v2.source-disabled", { eligible: false }),
      declaration("opencode-v2.experimental", {
        classification: "lossy/unrepresentable",
        stability: "experimental",
        eligible: false,
        representation: "unrepresentable",
        semanticLoss: ["Experimental discovery is not an admitted contract."],
      }),
    ]);

    const result = discover(record);

    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions).toHaveLength(2);
    expect(codes(result)).toEqual(expect.arrayContaining([
      "source_declared_ineligible",
      "experimental_contract",
    ]));
    expect(codes(result)).not.toContain("native_route_deferred");
  });

  it.each([
    ["stale TTL", { freshness: { observedAt: OBSERVED_AT, validUntil: "2026-08-29T11:59:59.999Z", status: "current" } }, "stale"],
    ["incomplete observation", { completeness: "partial" }, "incomplete"],
    ["invalidated observation", { invalidated: true }, "invalidated"],
  ] as const)("keeps %s visible as an ineligible decision", (_label, override, diagnosticFragment) => {
    const result = discover(recordsWithOneDeclaration()[0]!, override);

    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions).toHaveLength(1);
    expect(result.catalog.decisions[0]?.status).toBe("ineligible");
    expect(codes(result).some((code) => code.includes(diagnosticFragment))).toBe(true);
  });

  it("retains malformed, contradictory, and cross-artifact declarations as safe decisions", () => {
    const record = compatibilityRecord("codex", [
      declaration("codex.malformed", { unexpected: "ignored" }),
      declaration("codex.cross-artifact", { sourceArtifacts: ["missing-artifact"] }),
      declaration("codex.contradictory", { representation: "lossless", semanticLoss: ["loss"] }),
    ]);

    const result = discover(record);

    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions).toHaveLength(record.capabilities.length);
    expect(result.catalog.decisions.every((decision) => decision.status === "ineligible")).toBe(true);
    expect(codes(result).some((code) => code.includes("malformed"))).toBe(true);
    expect(codes(result).some((code) => code.includes("contradictory"))).toBe(true);
    expect(codes(result).some((code) => code.includes("source_artifact"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("missing-artifact");
    expect(JSON.stringify(result)).not.toContain("sdk/types.ts");
  });

  it("fails closed for secret-bearing and accessor declarations without invoking accessors", () => {
    const secretRecord = compatibilityRecord("claude", [
      declaration("claude.secret", { apiToken: "synthetic-secret-value" }),
    ]);
    const accessorRecord = compatibilityRecord("claude", [declaration("claude.accessor")]);
    let accessorInvoked = false;
    Object.defineProperty(accessorRecord.capabilities[0]!, "eligible", {
      enumerable: true,
      get() {
        accessorInvoked = true;
        throw new Error("accessor must not execute");
      },
    });

    const accessorDigest = digest(JSON.stringify({ ...accessorRecord, capabilities: [declaration("claude.accessor")] }));
    const secretResult = discover(secretRecord);
    const accessorResult = discover(accessorRecord, { recordDigest: accessorDigest });

    expect(accessorInvoked).toBe(false);
    expect(secretResult.catalog.descriptors).toEqual([]);
    expect(accessorResult.catalog.descriptors).toEqual([]);
    expect(secretResult.catalog.decisions).toHaveLength(1);
    expect(accessorResult.catalog.decisions).toHaveLength(1);
    expect(codes(secretResult).some((code) => code.includes("secret") || code.includes("malformed"))).toBe(true);
    expect(codes(accessorResult).some((code) => code.includes("malformed"))).toBe(true);
    expect(JSON.stringify([secretResult, accessorResult])).not.toContain("synthetic-secret-value");
    expect(JSON.stringify([secretResult, accessorResult])).not.toContain("accessor must not execute");
  });

  it("does not invoke commands or network/filesystem effects during discovery", () => {
    const effects: string[] = [];
    const record = compatibilityRecord("codex", [declaration("codex.inert")]);
    const result = discover(record, {
      liveEvidence: [{
        scope: "executable-version",
        command: () => effects.push("command"),
        bound: "synthetic",
        status: "observed",
        result: "synthetic",
      }],
    });

    expect(effects).toEqual([]);
    expect(result.catalog.descriptors).toEqual([]);
    expect(result.catalog.decisions).toHaveLength(1);
  });

  it("rejects proxy roots and capability arrays before reflective traps run", () => {
    const record = compatibilityRecord("codex", [declaration("codex.proxy")]);
    const rootTraps = { count: 0 };
    const rootProxy = new Proxy(
      { evaluatedAt: EVALUATED_AT, snapshot: snapshot(record) },
      reflectionTrapHandler(rootTraps),
    ) as unknown as Parameters<typeof discoverHarnessCompatibilityCapabilities>[0];
    expect(() => discoverHarnessCompatibilityCapabilities(rootProxy)).toThrow(TypeError);
    expect(rootTraps.count).toBe(0);

    const capabilityTraps = { count: 0 };
    const nestedSnapshot = snapshot(record) as unknown as { capabilities: Record<string, unknown>[] };
    nestedSnapshot.capabilities = new Proxy(
      [...nestedSnapshot.capabilities],
      reflectionTrapHandler(capabilityTraps),
    ) as unknown as Record<string, unknown>[];
    const result = discoverHarnessCompatibilityCapabilities({
      evaluatedAt: EVALUATED_AT,
      snapshot: nestedSnapshot as unknown as ReturnType<typeof snapshot>,
    });
    expect(capabilityTraps.count).toBe(0);
    expect(result.catalog.descriptors).toEqual([]);
    expect(codes(result)).toContain("record_malformed");
  });
});
