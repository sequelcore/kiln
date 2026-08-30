import { describe, expect, it } from "vitest";
import {
  createTrustedExecutionLimitationAcceptance,
  createTrustedExecutionLimitationRevocation,
  OPENCODE_NO_FILESYSTEM_SANDBOX,
  resolveTrustedExecutionLimitationAcceptance,
} from "../../src/security/trusted-execution-semantic-limitation.js";

describe("trusted execution semantic limitation decisions", () => {
  it("accepts only exact current evidence and remains revocable", () => {
    const acceptance = createAcceptance();
    const accepted = resolveTrustedExecutionLimitationAcceptance(
      [{ kind: "accept", acceptance }],
      OPENCODE_NO_FILESYSTEM_SANDBOX,
      "2026-09-01T00:00:00.000Z",
    );
    expect(accepted).toMatchObject({ revocable: true, acceptedBy: "operator:test" });

    const revocation = createTrustedExecutionLimitationRevocation({
      descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
      revokedBy: "operator:test",
      revokedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(
      resolveTrustedExecutionLimitationAcceptance(
        [{ kind: "accept", acceptance }, revocation],
        OPENCODE_NO_FILESYSTEM_SANDBOX,
        "2026-09-02T00:00:00.000Z",
      ),
    ).toBeUndefined();
  });

  it("rejects expiration, malformed receipts, and mismatched upstream evidence", () => {
    const acceptance = createAcceptance();
    expect(
      resolveTrustedExecutionLimitationAcceptance(
        [{ kind: "accept", acceptance }, { kind: "unknown" }],
        OPENCODE_NO_FILESYSTEM_SANDBOX,
        "2026-11-14T00:00:00.000Z",
      ),
    ).toBeUndefined();
    expect(
      resolveTrustedExecutionLimitationAcceptance(
        [{ kind: "accept", acceptance }],
        { ...OPENCODE_NO_FILESYSTEM_SANDBOX, upstreamRevision: "a".repeat(40) },
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBeUndefined();
  });
});

function createAcceptance() {
  return createTrustedExecutionLimitationAcceptance({
    descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
    acceptedBy: "operator:test",
    acceptedAt: "2026-08-13T01:00:00.000Z",
    reviewAfter: "2026-11-13T00:00:00.000Z",
  });
}
