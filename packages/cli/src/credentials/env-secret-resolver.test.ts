import { createSecretRef } from "@kilnai/core/credentials";
import { describe, expect, it } from "vitest";
import { EnvSecretResolver } from "./env-secret-resolver.js";

describe("EnvSecretResolver", () => {
  it("resolves an env-backed secret without exposing the value in diagnostics", async () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
    });
    const resolver = new EnvSecretResolver({
      env: { KILN_X_OAUTH2_ACCESS_TOKEN: " synthetic-token-value " },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    const resolved = await resolver.resolve(ref);

    expect(resolved).toMatchObject({
      value: "synthetic-token-value",
      diagnostic: {
        refId: "x-read-token",
        status: "available",
        source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
      },
    });
    expect(JSON.stringify(resolved.diagnostic)).not.toContain("synthetic-token-value");
  });

  it("fails closed with a missing diagnostic when the env var is absent", async () => {
    const ref = createSecretRef({
      id: "x-read-token",
      purpose: "external-engagement:x:read",
      scopes: ["x:post.read"],
      source: { kind: "env", name: "KILN_X_OAUTH2_ACCESS_TOKEN" },
    });
    const resolver = new EnvSecretResolver({
      env: {},
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    await expect(resolver.resolve(ref)).rejects.toMatchObject({
      diagnostic: {
        refId: "x-read-token",
        status: "missing",
        reason: "environment variable is not set",
      },
    });
  });
});
