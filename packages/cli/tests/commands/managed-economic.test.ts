import { describe, expect, it, vi } from "vitest";
import { managedEconomicCommand } from "../../src/commands/managed-economic.js";

const evidence = {
  attestation: "confirmed-not-dispatched",
  jobId: "job-1", economicAttemptId: "economic-attempt-1", dispatchFenceId: "fence-1", reservationId: "reservation-1",
  expectedPendingSettlementDigest: `sha256:${"1".repeat(64)}`,
  sourceEvidenceDigest: `sha256:${"2".repeat(64)}`,
  denialEvidenceDigest: `sha256:${"3".repeat(64)}`,
};

function connection(response: Response) {
  return { request: vi.fn(async () => response), close: vi.fn(), endpoint: vi.fn() };
}

describe("managed economic operator reconciliation", () => {
  it("sends exact evidence to Runtime and prints its retained receipt", async () => {
    const receipt = { state: "released", settlement: { kind: "not-dispatched" } };
    const session = connection(Response.json({ schemaVersion: 1, status: "ok", result: receipt }));
    const log = vi.fn();
    await managedEconomicCommand(["reconcile-not-dispatched", "--evidence", "evidence.json", "--json"], {
      readEvidence: async () => JSON.stringify(evidence), createSession: () => session, log,
    });
    expect(session.request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, operation: "managed-economic.reconcile-not-dispatched", input: evidence }),
    }));
    expect(log).toHaveBeenCalledWith(JSON.stringify(receipt));
    expect(session.close).toHaveBeenCalledOnce();
  });

  it.each([
    { ...evidence, sourceEvidenceDigest: "missing" },
    { ...evidence, authorityEvidenceDigest: `sha256:${"4".repeat(64)}` },
  ])("rejects malformed or caller-authored authority before connecting", async (input) => {
    const createSession = vi.fn();
    await expect(managedEconomicCommand(["reconcile-not-dispatched", "--evidence", "evidence.json"], {
      readEvidence: async () => JSON.stringify(input), createSession,
    })).rejects.toThrow();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("surfaces owner rejection and closes without claiming release", async () => {
    const session = connection(Response.json({ schemaVersion: 1, status: "error", error: {
      code: "authority_rejected", message: "Dispatch evidence changed.",
    } }));
    const log = vi.fn();
    await expect(managedEconomicCommand(["reconcile-not-dispatched", "--evidence", "evidence.json"], {
      readEvidence: async () => JSON.stringify(evidence), createSession: () => session, log,
    })).rejects.toThrow("Dispatch evidence changed");
    expect(log).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });
});
