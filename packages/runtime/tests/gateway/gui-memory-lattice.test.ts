import { describe, expect, it, vi } from "vitest";
import {
  GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH,
  GuiMemoryLatticeGraphResponseSchema,
  type GuiMemoryLatticeGraphResponse,
} from "@kilnai/gateway-contracts";
import { createGuiMemoryLatticeRoutes } from "../../src/gateway/gui-memory-lattice.js";

function graphResponse(): GuiMemoryLatticeGraphResponse {
  return {
    snapshot: {
      nodes: [{
        id: "memory:record-1",
        recordId: "record-1",
        layer: "semantic",
        scope: { kind: "project", id: "kiln" },
        label: "memory lattice",
        score: 1,
        lifecycleEvidence: {
          tags: ["lifecycle:promoted", "lifecycle:retained"],
          relationTypes: ["supports", "revises"],
          revisionCount: 3,
          admissionCount: 2,
          latestAdmissionDecision: "admitted",
        },
      }],
      edges: [],
      limits: { maxNodes: 25, maxEdges: 50 },
      truncated: false,
    },
    filters: {
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
      query: "admission",
      depth: 1,
    },
  };
}

describe("GUI Memory Lattice routes", () => {
  it("reads graph snapshots through the core memory resource contract", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{
        uri: "kiln://memory/graph",
        mimeType: "application/json",
        text: JSON.stringify(graphResponse()),
      }],
    });
    const app = createGuiMemoryLatticeRoutes({ resources: { readResource } });

    const response = await app.request(
      "http://localhost/memory/graph?scopeKind=project&scopeId=kiln&layer=semantic&query=admission&depth=1&limit=25",
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const parsed = GuiMemoryLatticeGraphResponseSchema.parse(json);
    expect(parsed).toEqual(graphResponse());
    expect(parsed.snapshot.nodes[0]?.lifecycleEvidence).toEqual(
      graphResponse().snapshot.nodes[0]?.lifecycleEvidence,
    );
    expect(readResource).toHaveBeenCalledWith(
      "kiln://memory/graph?scopeKind=project&scopeId=kiln&layer=semantic&query=admission&depth=1&limit=25",
    );
  });

  it("applies the configured default scope when the GUI does not send an explicit scope", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{
        uri: "kiln://memory/graph",
        mimeType: "application/json",
        text: JSON.stringify(graphResponse()),
      }],
    });
    const app = createGuiMemoryLatticeRoutes({
      resources: { readResource },
      defaultScope: { kind: "project", id: "kiln" },
    });

    const response = await app.request("http://localhost/memory/graph?depth=0&limit=25");

    expect(response.status).toBe(200);
    expect(readResource).toHaveBeenCalledWith(
      "kiln://memory/graph?scopeKind=project&scopeId=kiln&depth=0&limit=25",
    );
  });

  it("does not override an explicit GUI memory scope", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{
        uri: "kiln://memory/graph",
        mimeType: "application/json",
        text: JSON.stringify(graphResponse()),
      }],
    });
    const app = createGuiMemoryLatticeRoutes({
      resources: { readResource },
      defaultScope: { kind: "project", id: "kiln" },
    });

    const response = await app.request("http://localhost/memory/graph?scopeKind=session&scopeId=s-1&depth=0&limit=25");

    expect(response.status).toBe(200);
    expect(readResource).toHaveBeenCalledWith(
      "kiln://memory/graph?scopeKind=session&scopeId=s-1&depth=0&limit=25",
    );
  });

  it("rejects unsupported query parameters before resource reads", async () => {
    const readResource = vi.fn();
    const app = createGuiMemoryLatticeRoutes({ resources: { readResource } });

    const response = await app.request("http://localhost/memory/graph?uri=kiln://session/tasks");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_memory_lattice_request",
      message: "Unsupported Memory Lattice query parameter: uri",
    });
    expect(readResource).not.toHaveBeenCalled();
  });

  it("rejects oversized search queries before resource reads", async () => {
    const readResource = vi.fn();
    const app = createGuiMemoryLatticeRoutes({ resources: { readResource } });
    const query = "x".repeat(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH + 1);

    const response = await app.request(`http://localhost/memory/graph?query=${query}`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_memory_lattice_request",
      message: `Memory Lattice query must be ${GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH} characters or fewer.`,
    });
    expect(readResource).not.toHaveBeenCalled();
  });

  it("fails closed when the memory resource payload is malformed", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{
        uri: "kiln://memory/graph",
        mimeType: "application/json",
        text: JSON.stringify({ snapshot: { nodes: [] } }),
      }],
    });
    const app = createGuiMemoryLatticeRoutes({ resources: { readResource } });

    const response = await app.request("http://localhost/memory/graph");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "memory_lattice_unavailable",
      message: "Memory Lattice graph is not available through the runtime resource plane.",
    });
  });
});
