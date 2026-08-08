import { describe, expect, it } from "vitest";
import {
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  OperatorProjectBindingSchema,
  OperatorProjectRuntimeStatusSchema,
  OperatorSessionClaimsSchema,
  OperatorSupervisorIdentitySchema,
  OperatorSupervisorStatusSchema,
} from "../src/operator-runtime.js";

const projectBinding = {
  projectRuntimeId: `krp_${"a".repeat(64)}`,
  markerDigest: `sha256:${"b".repeat(64)}`,
} as const;

const identity = {
  protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
  service: "kiln-operator-runtime",
  instanceId: "operator-runtime-01",
  version: "3.0.0-beta.1",
  pid: 42,
  startedAt: 1_700_000_000,
  port: 43_210,
} as const;

describe("operator runtime contracts", () => {
  it("accepts a versioned supervisor identity and opaque project binding", () => {
    expect(OperatorSupervisorIdentitySchema.parse(identity)).toEqual(identity);
    expect(OperatorProjectBindingSchema.parse(projectBinding)).toEqual(projectBinding);
  });

  it("accepts closed session claims and status evidence", () => {
    expect(
      OperatorSessionClaimsSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        audience: "kiln-operator-runtime",
        ...projectBinding,
        harness: "codex",
        sessionId: "session-01",
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_300,
      }),
    ).toMatchObject({ harness: "codex", sessionId: "session-01" });

    expect(
      OperatorSupervisorStatusSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        identity,
        lifecycle: "ready",
        diagnostic: "none",
        activeProjectRuntimeCount: 2,
      }),
    ).toMatchObject({ lifecycle: "ready", diagnostic: "none" });

    expect(
      OperatorProjectRuntimeStatusSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        binding: projectBinding,
        lifecycle: "recovering",
        diagnostic: "none",
      }),
    ).toMatchObject({ binding: projectBinding, lifecycle: "recovering" });
  });

  it.each([
    { ...projectBinding, projectRuntimeId: "C:/operator/private/project" },
    { ...projectBinding, projectRuntimeId: `krp_${"A".repeat(64)}` },
    { ...projectBinding, markerDigest: "sha256:not-a-digest" },
    { ...projectBinding, markerDigest: `sha256:${"B".repeat(64)}` },
  ])("rejects non-opaque or malformed project binding evidence", (binding) => {
    expect(() => OperatorProjectBindingSchema.parse(binding)).toThrow();
  });

  it.each(["cursor", "gemini", "", "CODEX"])("rejects an unknown harness %s", (harness) => {
    expect(() =>
      OperatorSessionClaimsSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        audience: "kiln-operator-runtime",
        ...projectBinding,
        harness,
        sessionId: "session-01",
        issuedAt: 1_700_000_000,
        expiresAt: 1_700_000_300,
      }),
    ).toThrow();
  });

  it("bounds portable session identifiers and epoch-second fields", () => {
    const claims = {
      protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
      audience: "kiln-operator-runtime",
      ...projectBinding,
      harness: "claude",
      sessionId: "session-01",
      issuedAt: 1_700_000_000,
      expiresAt: 1_700_000_300,
    } as const;

    expect(() => OperatorSessionClaimsSchema.parse({ ...claims, sessionId: "../escape" })).toThrow();
    expect(() => OperatorSessionClaimsSchema.parse({ ...claims, sessionId: "x".repeat(129) })).toThrow();
    expect(() => OperatorSessionClaimsSchema.parse({ ...claims, issuedAt: 1.5 })).toThrow();
    expect(() => OperatorSessionClaimsSchema.parse({ ...claims, expiresAt: -1 })).toThrow();
  });

  it("rejects unknown keys and values outside closed status enums", () => {
    expect(() => OperatorSupervisorIdentitySchema.parse({ ...identity, root: "C:/private" })).toThrow();
    expect(() => OperatorSupervisorIdentitySchema.parse({ ...identity, version: "" })).toThrow();
    expect(() => OperatorSupervisorIdentitySchema.parse({ ...identity, version: "x".repeat(65) })).toThrow();
    expect(() => OperatorProjectBindingSchema.parse({ ...projectBinding, secret: "leak" })).toThrow();
    expect(() =>
      OperatorSupervisorStatusSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        identity,
        lifecycle: "running",
        diagnostic: "raw-error-message",
        activeProjectRuntimeCount: 0,
      }),
    ).toThrow();
    expect(() =>
      OperatorProjectRuntimeStatusSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        binding: projectBinding,
        lifecycle: "degraded",
        diagnostic: "raw-error-message",
      }),
    ).toThrow();
    expect(() =>
      OperatorProjectRuntimeStatusSchema.parse({
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        binding: projectBinding,
        lifecycle: "unavailable",
        diagnostic: "project_unavailable",
        projectRoot: "C:/private",
      }),
    ).toThrow();
  });
});
