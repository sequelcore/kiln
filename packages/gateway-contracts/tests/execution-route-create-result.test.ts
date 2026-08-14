import { describe, expect, it } from "vitest";
import { ExecutionRouteCreateResultSchema } from "../src/execution-route-creation.js";

const catalogs = { executionRouteCatalog: { routes: [], revision: `sha256:${"a".repeat(64)}` }, availableModels: { observedAt: "2026-08-13T18:00:00.000Z", entries: [] } };
const revision = `sha256:${"b".repeat(64)}`;

describe("ExecutionRouteCreateResultSchema", () => {
  it("admits only exact created and committed-refresh-failed shapes", () => {
    expect(ExecutionRouteCreateResultSchema.parse({ type: "execution_route_create_result", requestId: "request", status: "created", code: "EXECUTION_ROUTE_CREATED", message: "Created.", revision, ...catalogs })).toBeTruthy();
    expect(ExecutionRouteCreateResultSchema.parse({ type: "execution_route_create_result", requestId: "request", status: "committed-refresh-failed", code: "EXECUTION_ROUTE_COMMITTED_REFRESH_FAILED", message: "Committed.", revision })).toBeTruthy();
  });

  it.each([
    { type: "execution_route_create_result", requestId: "request", status: "created", code: "EXECUTION_ROUTE_CREATE_REJECTED", message: "x", revision, ...catalogs },
    { type: "execution_route_create_result", requestId: "request", status: "created", code: "EXECUTION_ROUTE_CREATED", message: "x", revision },
    { type: "execution_route_create_result", requestId: "request", status: "committed-refresh-failed", code: "EXECUTION_ROUTE_COMMITTED_REFRESH_FAILED", message: "x", revision, ...catalogs },
    { type: "execution_route_create_result", requestId: "request", status: "rejected", code: "EXECUTION_ROUTE_CREATE_DENIED", message: "x", revision },
    { type: "execution_route_create_result", requestId: "request", status: "rejected", code: "EXECUTION_ROUTE_CREATED", message: "x" },
    { type: "execution_route_create_result", requestId: "request", status: "rejected", code: "EXECUTION_ROUTE_CREATE_REJECTED", message: "x", unknown: true },
  ])("rejects impossible or unknown combinations", (value) => {
    expect(() => ExecutionRouteCreateResultSchema.parse(value)).toThrow();
  });
});
