import { describe, expect, it } from "vitest";
import { resolveEvidenceRealization } from "../../src/work-governance/evidence-realization.js";

describe("resolveEvidenceRealization", () => {
  it("resolves tests/typecheck evidence to bash for an ordinary shell-capable route with no declared realizations", () => {
    const result = resolveEvidenceRealization({
      routeId: "codex-shell",
      expectedEvidence: ["tests", "typecheck"],
      admittedToolNames: ["bash", "read"],
    });

    expect(result).toEqual({ ok: true, requiredToolNames: ["bash"] });
  });

  it("admits an MCP-only route via its own declared realization instead of requiring bash", () => {
    const result = resolveEvidenceRealization({
      routeId: "external-runtime-mcp-only",
      expectedEvidence: ["tests", "typecheck"],
      declaredRealizations: {
        tests: ["mcp:external-runtime:tool:start_stop_test", "mcp:external-runtime:tool:observe_runtime"],
        typecheck: ["mcp:external-runtime:tool:observe_runtime", "mcp:external-runtime:tool:read_console"],
      },
      admittedToolNames: [
        "mcp:external-runtime:tool:start_stop_test",
        "mcp:external-runtime:tool:observe_runtime",
        "mcp:external-runtime:tool:read_console",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && [...result.requiredToolNames].sort()).toEqual([
      "mcp:external-runtime:tool:observe_runtime",
      "mcp:external-runtime:tool:read_console",
      "mcp:external-runtime:tool:start_stop_test",
    ]);
  });

  it("returns a capability pause when neither a declared nor the default realization is fully admitted", () => {
    const result = resolveEvidenceRealization({
      routeId: "external-runtime-mcp-only",
      expectedEvidence: ["tests", "typecheck"],
      admittedToolNames: ["mcp:external-runtime:tool:inspect_tree"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a capability pause");
    expect(result.pause).toMatchObject({
      status: "capability_pause",
      unrealizedEvidence: ["tests", "typecheck"],
      routeId: "external-runtime-mcp-only",
      admittedToolNames: ["mcp:external-runtime:tool:inspect_tree"],
    });
    expect(result.pause.reason).toContain("tests");
    expect(result.pause.reason).toContain("typecheck");
  });

  it("does not accept a declared realization that references a tool the route no longer admits (drift closes to a pause, not a silent pass)", () => {
    const result = resolveEvidenceRealization({
      routeId: "drifted-route",
      expectedEvidence: ["tests"],
      declaredRealizations: {
        tests: ["mcp:external-runtime:tool:start_stop_test"],
      },
      // The route's own allowedToolNames no longer includes the tool its
      // evidenceRealizations declaration still references.
      admittedToolNames: ["mcp:external-runtime:tool:inspect_tree"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a capability pause");
    expect(result.pause.unrealizedEvidence).toEqual(["tests"]);
  });

  it("does not fall back to bash once a route declares its own (non-admitted) realization for that evidence", () => {
    const result = resolveEvidenceRealization({
      routeId: "declares-but-not-admitted",
      expectedEvidence: ["tests"],
      declaredRealizations: {
        tests: ["some-tool-not-admitted"],
      },
      admittedToolNames: ["bash"],
    });

    // The route explicitly declared a realization for "tests"; since that
    // declaration isn't satisfied, we must not silently substitute the
    // generic bash default behind the route's back - fail closed instead.
    expect(result.ok).toBe(false);
  });

  it("passes evidence with no tool-based realization concept through untouched", () => {
    const result = resolveEvidenceRealization({
      routeId: "any-route",
      expectedEvidence: ["plan", "residual-risk", "managed-agent-review"],
      admittedToolNames: [],
    });

    expect(result).toEqual({ ok: true, requiredToolNames: [] });
  });

  it("preserves the default realization for visual-reference-research and browser-qa unchanged", () => {
    const visual = resolveEvidenceRealization({
      routeId: "route-1",
      expectedEvidence: ["visual-reference-research"],
      admittedToolNames: ["read", "glob", "grep"],
    });
    expect(visual.ok && [...visual.requiredToolNames].sort()).toEqual(["glob", "grep", "read"]);

    const browserQa = resolveEvidenceRealization({
      routeId: "route-2",
      expectedEvidence: ["browser-qa"],
      admittedToolNames: ["browser_session_start", "browser_navigate", "browser_observe"],
    });
    expect(browserQa.ok && [...browserQa.requiredToolNames].sort()).toEqual([
      "browser_navigate",
      "browser_observe",
      "browser_session_start",
    ]);
  });
});
