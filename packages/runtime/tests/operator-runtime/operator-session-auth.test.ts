import { createHmac } from "node:crypto";
import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  type OperatorSessionClaims,
} from "@kilnai/gateway-contracts";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_SESSION_CLOCK_SKEW_SECONDS,
  OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
  OperatorSessionCredentialError,
  signOperatorSessionCredential,
  verifyOperatorSessionCredential,
} from "../../src/operator-runtime/operator-session-auth.js";

const secret = Buffer.from("a".repeat(64), "utf8");
const otherSecret = Buffer.from("b".repeat(64), "utf8");
const now = 1_700_000_000;
const binding = {
  projectRuntimeId: `krp_${"a".repeat(64)}`,
  markerDigest: `sha256:${"b".repeat(64)}`,
} as const;
const claims: OperatorSessionClaims = {
  protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
  audience: OPERATOR_RUNTIME_AUDIENCE,
  ...binding,
  harness: "codex",
  sessionId: "session-01",
  issuedAt: now,
  expiresAt: now + OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
};
const expected = {
  ...binding,
  harness: "codex",
  sessionId: "session-01",
} as const;

function expectCredentialError(action: () => unknown, code: OperatorSessionCredentialError["code"]): void {
  try {
    action();
    throw new Error("Expected credential verification to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(OperatorSessionCredentialError);
    expect((error as OperatorSessionCredentialError).code).toBe(code);
  }
}

function signRaw(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`v1.${encodedPayload}`, "ascii").digest("base64url");
  return `v1.${encodedPayload}.${signature}`;
}

describe("operator session credentials", () => {
  it("signs a deterministic compact credential and verifies its complete binding", () => {
    const first = signOperatorSessionCredential(claims, secret);
    const second = signOperatorSessionCredential({ ...claims }, secret);

    expect(first).toBe(second);
    expect(first.split(".")).toHaveLength(3);
    expect(verifyOperatorSessionCredential(first, secret, expected, { nowEpochSeconds: now })).toEqual(claims);
  });

  it("rejects malformed, non-canonical, tampered, and wrongly signed credentials", () => {
    const credential = signOperatorSessionCredential(claims, secret);
    const [version, payload, signature] = credential.split(".") as [string, string, string];
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

    expectCredentialError(
      () => verifyOperatorSessionCredential("not-a-credential", secret, expected, { nowEpochSeconds: now }),
      "malformed",
    );
    expectCredentialError(
      () =>
        verifyOperatorSessionCredential(`${version}.${tamperedPayload}.${signature}`, secret, expected, {
          nowEpochSeconds: now,
        }),
      "invalid_signature",
    );
    expectCredentialError(
      () => verifyOperatorSessionCredential(credential, otherSecret, expected, { nowEpochSeconds: now }),
      "invalid_signature",
    );
    expectCredentialError(
      () =>
        verifyOperatorSessionCredential(signRaw({ ...claims, unexpected: true }), secret, expected, {
          nowEpochSeconds: now,
        }),
      "invalid_claims",
    );
    const nonCanonical = signRaw({
      expiresAt: claims.expiresAt,
      issuedAt: claims.issuedAt,
      sessionId: claims.sessionId,
      harness: claims.harness,
      markerDigest: claims.markerDigest,
      projectRuntimeId: claims.projectRuntimeId,
      audience: claims.audience,
      protocolVersion: claims.protocolVersion,
    });
    expectCredentialError(
      () => verifyOperatorSessionCredential(nonCanonical, secret, expected, { nowEpochSeconds: now }),
      "invalid_claims",
    );
  });

  it("rejects expired and not-yet-valid credentials outside the explicit clock skew", () => {
    const expired = signOperatorSessionCredential(
      {
        ...claims,
        issuedAt: now - OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
        expiresAt: now - OPERATOR_SESSION_CLOCK_SKEW_SECONDS - 1,
      },
      secret,
    );
    const future = signOperatorSessionCredential(
      {
        ...claims,
        issuedAt: now + OPERATOR_SESSION_CLOCK_SKEW_SECONDS + 1,
        expiresAt: now + OPERATOR_SESSION_CLOCK_SKEW_SECONDS + 61,
      },
      secret,
    );

    expectCredentialError(
      () => verifyOperatorSessionCredential(expired, secret, expected, { nowEpochSeconds: now }),
      "expired",
    );
    expectCredentialError(
      () => verifyOperatorSessionCredential(future, secret, expected, { nowEpochSeconds: now }),
      "not_yet_valid",
    );
  });

  it("rejects credentials whose lifetime exceeds the fixed maximum", () => {
    expect(() =>
      signOperatorSessionCredential(
        {
          ...claims,
          expiresAt: claims.issuedAt + OPERATOR_SESSION_MAX_LIFETIME_SECONDS + 1,
        },
        secret,
      ),
    ).toThrow(OperatorSessionCredentialError);

    const forged = signRaw({
      ...claims,
      expiresAt: claims.issuedAt + OPERATOR_SESSION_MAX_LIFETIME_SECONDS + 1,
    });
    expectCredentialError(
      () => verifyOperatorSessionCredential(forged, secret, expected, { nowEpochSeconds: now }),
      "lifetime_exceeded",
    );
  });

  it("rejects a wrong audience even when signed with the trusted secret", () => {
    const forged = signRaw({ ...claims, audience: "another-service" });
    expectCredentialError(
      () => verifyOperatorSessionCredential(forged, secret, expected, { nowEpochSeconds: now }),
      "invalid_claims",
    );
  });

  it.each([
    [{ ...expected, harness: "claude" }, "harness"],
    [{ ...expected, sessionId: "session-02" }, "session"],
    [{ ...expected, projectRuntimeId: `krp_${"c".repeat(64)}` }, "project"],
    [{ ...expected, markerDigest: `sha256:${"d".repeat(64)}` }, "binding"],
  ] as const)("rejects an expected %s mismatch", (wrongExpected) => {
    const credential = signOperatorSessionCredential(claims, secret);
    expectCredentialError(
      () => verifyOperatorSessionCredential(credential, secret, wrongExpected, { nowEpochSeconds: now }),
      "binding_mismatch",
    );
  });

  it("rejects secrets below the minimum key-length boundary", () => {
    expect(() => signOperatorSessionCredential(claims, Buffer.alloc(31))).toThrow(OperatorSessionCredentialError);
    const credential = signOperatorSessionCredential(claims, secret);
    expectCredentialError(
      () => verifyOperatorSessionCredential(credential, Buffer.alloc(31), expected, { nowEpochSeconds: now }),
      "invalid_secret",
    );
  });
});
