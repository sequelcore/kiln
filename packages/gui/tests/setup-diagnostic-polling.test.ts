import { describe, expect, it } from "vitest";
import { setupDiagnosticRefetchInterval } from "../src/lib/setup-diagnostic-polling.js";

describe("setupDiagnosticRefetchInterval", () => {
  it.each(["pending", "stale"] as const)("polls while diagnostics are %s", (state) => {
    expect(setupDiagnosticRefetchInterval({ skillDiagnostics: { state } })).toBe(750);
  });

  it.each(["current", "empty", "failed", "not_collected"] as const)("stops polling when diagnostics are %s", (state) => {
    expect(setupDiagnosticRefetchInterval({ skillDiagnostics: { state } })).toBe(false);
  });

  it("does not poll before the first setup snapshot", () => {
    expect(setupDiagnosticRefetchInterval(undefined)).toBe(false);
  });
});
