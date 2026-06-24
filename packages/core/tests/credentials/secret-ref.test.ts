import { describe, expect, it } from "vitest";
import {
  createSecretRef,
  diagnoseSecretResolution,
  evaluateSecretLifecycle,
  validateSecretRef,
  type SecretRef,
} from "../../src/credentials/index.js";

describe("SecretRef", () => {
  it("creates an env-backed secret reference with credential governance metadata", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-07-24T00:00:00.000Z",
      rotation: {
        kind: "manual",
        nextRotationAt: "2026-07-20T00:00:00.000Z",
      },
      refresh: {
        kind: "oauth2-refresh-token",
        refreshSecretRefId: "x-refresh-token",
        nextRefreshAt: "2026-07-23T00:00:00.000Z",
      },
    });

    expect(ref).toEqual({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read", "x:user.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-07-24T00:00:00.000Z",
      rotation: {
        kind: "manual",
        nextRotationAt: "2026-07-20T00:00:00.000Z",
      },
      refresh: {
        kind: "oauth2-refresh-token",
        refreshSecretRefId: "x-refresh-token",
        nextRefreshAt: "2026-07-23T00:00:00.000Z",
      },
    });
  });

  it("rejects invalid env source names and empty scopes", () => {
    expect(() => createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: [],
      source: { kind: "env", name: "bad-name" },
    })).toThrow(/scopes must contain at least one scope/u);

    expect(validateSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "bad-name" },
    } satisfies SecretRef)).toEqual([{
      field: "source.name",
      message: "env secret source name must be a valid environment variable name",
    }]);
  });

  it("reports available diagnostics without exposing resolved secret values", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-07-24T00:00:00.000Z",
    });

    const diagnostic = diagnoseSecretResolution(ref, {
      status: "available",
      resolvedAt: "2026-06-24T00:00:00.000Z",
      value: "synthetic-token-value",
    }, new Date("2026-06-24T00:00:00.000Z"));

    expect(diagnostic).toEqual({
      refId: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      status: "available",
      expiresAt: "2026-07-24T00:00:00.000Z",
      resolvedAt: "2026-06-24T00:00:00.000Z",
      lifecycle: { status: "usable" },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("synthetic-token-value");
  });

  it("fails closed when expiry metadata says the credential is expired", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-06-23T23:59:59.000Z",
    });

    expect(diagnoseSecretResolution(ref, {
      status: "available",
      resolvedAt: "2026-06-24T00:00:00.000Z",
      value: "synthetic-token-value",
    }, new Date("2026-06-24T00:00:00.000Z"))).toMatchObject({
      status: "expired",
      reason: "secret reference expiry has passed",
    });
  });

  it("reports missing and invalid sources without secret-bearing fields", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
    });

    expect(diagnoseSecretResolution(ref, {
      status: "missing",
      reason: "environment variable is not set",
    }, new Date("2026-06-24T00:00:00.000Z"))).toEqual({
      refId: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      status: "missing",
      reason: "environment variable is not set",
      lifecycle: { status: "usable" },
    });
  });

  it("models managed secret-manager references without assuming a public provider", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: {
        kind: "managed",
        providerId: "operator-secret-manager",
        reference: "project/external-engagement/x/access-token",
        version: "current",
      },
      rotation: {
        kind: "leased",
        leaseExpiresAt: "2026-06-24T01:00:00.000Z",
        renewable: true,
      },
    });

    expect(ref.source).toEqual({
      kind: "managed",
      providerId: "operator-secret-manager",
      reference: "project/external-engagement/x/access-token",
      version: "current",
    });
  });

  it("models runtime credential-pool references as a bridge without importing runtime", () => {
    const ref = createSecretRef({
      id: "openai-primary-key",
      purpose: "provider-route:openai",
      scopes: ["model:responses"],
      source: {
        kind: "credential-pool",
        providerId: "openai",
        field: "apiKey",
      },
    });

    expect(ref.source).toEqual({
      kind: "credential-pool",
      providerId: "openai",
      field: "apiKey",
    });
  });

  it("evaluates refresh and rotation lifecycle metadata before expiry", () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      expiresAt: "2026-06-24T02:00:00.000Z",
      rotation: {
        kind: "manual",
        nextRotationAt: "2026-06-24T00:30:00.000Z",
      },
      refresh: {
        kind: "oauth2-refresh-token",
        refreshSecretRefId: "x-refresh-token",
        nextRefreshAt: "2026-06-24T00:15:00.000Z",
      },
    });

    expect(evaluateSecretLifecycle(ref, new Date("2026-06-24T00:20:00.000Z"))).toEqual({
      status: "refresh-due",
      reason: "credential refresh is due",
      dueAt: "2026-06-24T00:15:00.000Z",
    });
    expect(evaluateSecretLifecycle(ref, new Date("2026-06-24T00:40:00.000Z"))).toEqual({
      status: "refresh-due",
      reason: "credential refresh is due",
      dueAt: "2026-06-24T00:15:00.000Z",
    });
    expect(evaluateSecretLifecycle({
      ...ref,
      refresh: undefined,
    }, new Date("2026-06-24T00:40:00.000Z"))).toEqual({
      status: "rotation-due",
      reason: "credential rotation is due",
      dueAt: "2026-06-24T00:30:00.000Z",
    });
  });
});
