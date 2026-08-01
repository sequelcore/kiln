import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyBackendBenchmarkLease } from "../../src/application/benchmark-backend-verifier.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const CORRECT_IMPLEMENTATION = `export function reserveStock(state, sku, quantity, requestId) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer");
  if (Object.hasOwn(state.reservations, requestId)) return state.reservations[requestId];
  if (!Object.hasOwn(state.stock, sku)) throw new Error("Unknown SKU");
  if (state.stock[sku] < quantity) throw new Error("Insufficient stock");
  const remaining = state.stock[sku] - quantity;
  const reservation = { sku, quantity, remaining, requestId };
  state.stock[sku] = remaining;
  state.reservations[requestId] = reservation;
  return reservation;
}
`;

describe("backend benchmark Docker verifier", () => {
  it("executes the hidden suite inside the pinned isolated container", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(
      resolveProjectRoot().rootPath,
      "packages/core/evals/fixtures/model-roster-backend-write-v1",
    );
    try {
      await writeFile(join(lease.rootPath, "src", "order-service.mjs"), CORRECT_IMPLEMENTATION, "utf8");
      await expect(verifyBackendBenchmarkLease({ lease })).resolves.toMatchObject({
        status: "passed",
        tests: { exitCode: 0, passed: 4, failed: 0, timedOut: false },
      });
    } finally {
      lease.cleanup();
    }
  }, 60_000);
});
