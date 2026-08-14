import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyBackendBenchmarkLease } from "../../src/application/benchmark-backend-verifier.js";
import type { BackendBenchmarkCaseId } from "../../src/application/benchmark-backend-cases.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const REFERENCES: Readonly<Record<BackendBenchmarkCaseId, string>> = {
  "idempotent-reservation": `export function reserveStock(state, sku, quantity, requestId) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer");
  if (Object.hasOwn(state.reservations, requestId)) return state.reservations[requestId];
  if (!Object.hasOwn(state.stock, sku)) throw new Error("Unknown SKU");
  if (state.stock[sku] < quantity) throw new Error("Insufficient stock");
  const remaining = state.stock[sku] - quantity;
  const reservation = { sku, quantity, remaining, requestId };
  state.stock[sku] = remaining; state.reservations[requestId] = reservation; return reservation;
}`,
  "atomic-transfer": `export function transferFunds(state, from, to, amount, requestId) {
  if (Object.hasOwn(state.transfers, requestId)) return state.transfers[requestId];
  if (!Object.hasOwn(state.balances, from) || !Object.hasOwn(state.balances, to)) throw new Error("Unknown account");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid amount");
  if (state.balances[from] < amount) throw new Error("Insufficient funds");
  const transfer = { requestId, from, to, amount };
  state.balances[from] -= amount; state.balances[to] += amount; state.transfers[requestId] = transfer; return transfer;
}`,
  "optimistic-revision": `export function applyRevision(state, id, expectedRevision, patch) {
  const document = state.documents[id];
  if (!document) throw new Error("Unknown document");
  if (document.revision !== expectedRevision) throw new Error("Revision conflict");
  if (!patch || Object.getPrototypeOf(patch) !== Object.prototype) throw new Error("Invalid patch");
  const keys = Object.keys(patch); if (keys.length === 0 || keys.some((key) => key !== "title" && key !== "status")) throw new Error("Invalid patch");
  const next = { ...document, ...patch, revision: document.revision + 1 }; state.documents[id] = next; return next;
}`,
  "event-deduplication": `export function applyInventoryEvent(state, event) {
  if (!event || typeof event.id !== "string" || event.id.length === 0 || typeof event.sku !== "string" || event.sku.length === 0 || !Number.isInteger(event.delta)) throw new Error("Malformed event");
  if (Object.hasOwn(state.processedEventIds, event.id)) return state.stock[event.sku] ?? 0;
  const next = (state.stock[event.sku] ?? 0) + event.delta; if (next < 0) throw new Error("Negative stock");
  state.stock[event.sku] = next; state.processedEventIds[event.id] = true; return next;
}`,
  "stable-pagination": `export function pageAfter(records, afterId, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  const sorted = [...records].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(sorted.map((record) => record.id)).size !== sorted.length) throw new Error("Duplicate id");
  const cursorIndex = afterId === null ? -1 : sorted.findIndex((record) => record.id === afterId);
  if (afterId !== null && cursorIndex < 0) throw new Error("Unknown cursor");
  const items = sorted.slice(cursorIndex + 1, cursorIndex + 1 + limit);
  const hasMore = cursorIndex + 1 + items.length < sorted.length;
  return { items, nextCursor: hasMore ? items.at(-1).id : null };
}`,
  "rate-window": `export function recordAttempt(state, actorId, nowMs, requestId, limit, windowMs) {
  if (typeof actorId !== "string" || actorId.length === 0 || typeof requestId !== "string" || requestId.length === 0 || !Number.isFinite(nowMs) || !Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowMs) || windowMs <= 0) throw new Error("Invalid input");
  if (Object.hasOwn(state.requests, requestId)) return state.requests[requestId];
  const active = (state.attempts[actorId] ?? []).filter((value) => value > nowMs - windowMs);
  const allowed = active.length < limit; if (allowed) active.push(nowMs);
  const result = { allowed, remaining: Math.max(0, limit - active.length) };
  state.attempts[actorId] = active; state.requests[requestId] = result; return result;
}`,
  "default-deny-access": `export function canAccess(policy, subject, action, resource) {
  if (!policy || !subject || typeof subject.id !== "string" || subject.id.length === 0 || !Array.isArray(subject.roles) || !resource || typeof resource.type !== "string" || typeof resource.id !== "string" || typeof action !== "string") return false;
  if (policy.resourceOwners?.[resource.id] === subject.id && (action === "read" || action === "write")) return true;
  const grant = resource.type + ":" + action;
  return subject.roles.some((role) => Array.isArray(policy.roles?.[role]) && policy.roles[role].includes(grant));
}`,
  "bounded-retry": `export function planRetry(attempt, maxAttempts, baseDelayMs, maxDelayMs, retryAfterMs) {
  const positive = (value) => Number.isInteger(value) && value > 0;
  if (!positive(attempt) || !positive(maxAttempts) || attempt > maxAttempts || !positive(baseDelayMs) || !positive(maxDelayMs) || baseDelayMs > maxDelayMs || (retryAfterMs !== undefined && (!Number.isInteger(retryAfterMs) || retryAfterMs < 0))) throw new Error("Invalid retry bounds");
  if (attempt === maxAttempts) return { retry: false, delayMs: 0, nextAttempt: null };
  const exponential = baseDelayMs * (2 ** (attempt - 1));
  return { retry: true, delayMs: Math.min(maxDelayMs, Math.max(exponential, retryAfterMs ?? 0)), nextAttempt: attempt + 1 };
}`,
};

describe("backend benchmark Docker verifier v2", () => {
  it.each(Object.entries(REFERENCES) as [BackendBenchmarkCaseId, string][])(
    "proves the %s case is solvable inside the pinned isolated container",
    async (benchmarkCaseId, implementation) => {
      const lease = createBenchmarkWriteWorkspaceLease(
        resolveProjectRoot().rootPath,
        `packages/core/evals/fixtures/model-roster-backend-write-v2/${benchmarkCaseId}`,
      );
      try {
        await writeFile(join(lease.rootPath, "src", "solution.mjs"), `${implementation}\n`, "utf8");
        await expect(verifyBackendBenchmarkLease({ lease, benchmarkCaseId })).resolves.toMatchObject({
          status: "passed",
          benchmarkCaseId,
          tests: { exitCode: 0, failed: 0, timedOut: false },
        });
      } finally {
        lease.cleanup();
      }
    },
    60_000,
  );
});
