import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH, type GuiMemoryLatticeGraphRequest, type GuiMemoryLatticeGraphResponse } from "@kilnai/gateway-contracts";
import { MemoryLatticePanel, MemoryLatticeSurface } from "../src/components/memory-lattice/memory-lattice-panel.js";

function installReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }));
}

function graphResponse(): GuiMemoryLatticeGraphResponse {
  return {
    snapshot: {
      nodes: [
        {
          id: "memory:record-alpha",
          recordId: "record-alpha",
          layer: "semantic",
          scope: { kind: "project", id: "kiln" },
          label: "Memory Lattice contract",
          score: 1,
        },
        {
          id: "memory:record-beta",
          recordId: "record-beta",
          layer: "episodic",
          scope: { kind: "session", id: "session-9" },
          label: "Admission evidence",
        },
      ],
      edges: [{
        id: "relation-1",
        sourceRecordId: "record-alpha",
        targetRecordId: "record-beta",
        relationType: "supports",
      }],
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

describe("MemoryLatticePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installReducedMotion(false);
  });

  it("renders graph nodes with list fallback and node detail selection", () => {
    const onSelectRecord = vi.fn();
    render(
      <MemoryLatticePanel
        filters={{ depth: 1, limit: 25 }}
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId="record-alpha"
        onFiltersChange={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRecord={onSelectRecord}
        graphOpen={false}
        onOpenGraph={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Memory graph")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memory Lattice contract" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admission evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Admission evidence" }));

    expect(onSelectRecord).toHaveBeenCalledWith("record-beta");
  });

  it("does not force a selected node before the operator locks one", async () => {
    const onSelectRecord = vi.fn();
    render(
      <MemoryLatticeSurface
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId={null}
        onRefresh={vi.fn()}
        onSelectRecord={onSelectRecord}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Memory graph")).toHaveAttribute("data-renderer", "three"));
    expect(screen.queryByRole("region", { name: "Memory record detail" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Admission evidence" }));

    expect(onSelectRecord).toHaveBeenCalledWith("record-beta");
  });

  it("renders the real graph canvas in the main Memory Lattice surface", async () => {
    render(
      <MemoryLatticeSurface
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId="record-beta"
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Memory Lattice surface")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Memory graph")).toHaveAttribute("data-renderer", "three"));
    expect(screen.getByRole("heading", { name: "Admission evidence" })).toBeInTheDocument();
  });

  it("applies supported graph filters without inventing memory logic", async () => {
    const onFiltersChange = vi.fn<(filters: GuiMemoryLatticeGraphRequest) => void>();
    render(
      <MemoryLatticePanel
        filters={{ depth: 0, limit: 25 }}
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId="record-alpha"
        onFiltersChange={onFiltersChange}
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search memory"), { target: { value: "topic key" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Scope kind" }));
    const projectScope = await screen.findByRole("option", { name: "project" });
    fireEvent.pointerEnter(projectScope);
    fireEvent.mouseMove(projectScope);
    fireEvent.click(projectScope);
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "kiln" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Layer" }));
    const semanticLayer = await screen.findByRole("option", { name: "semantic" });
    fireEvent.pointerEnter(semanticLayer);
    fireEvent.mouseMove(semanticLayer);
    fireEvent.click(semanticLayer);
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
      query: "topic key",
      depth: 0,
      limit: 25,
    });
  });

  it("bounds search text before applying filters", () => {
    const onFiltersChange = vi.fn<(filters: GuiMemoryLatticeGraphRequest) => void>();
    const boundedQuery = "x".repeat(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH);
    render(
      <MemoryLatticePanel
        filters={{ depth: 0, limit: 25 }}
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId="record-alpha"
        onFiltersChange={onFiltersChange}
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    const searchInput = screen.getByLabelText("Search memory");
    expect(searchInput).toHaveAttribute("maxlength", String(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH));

    fireEvent.change(searchInput, { target: { value: boundedQuery } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      query: boundedQuery,
      depth: 0,
      limit: 25,
    });
  });

  it("renders empty and error states", () => {
    const { rerender } = render(
      <MemoryLatticePanel
        filters={{}}
        response={{
          snapshot: {
            nodes: [],
            edges: [],
            limits: { maxNodes: 25, maxEdges: 50 },
            truncated: false,
          },
          filters: { depth: 0 },
        }}
        loading={false}
        error={null}
        selectedRecordId={null}
        onFiltersChange={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    expect(screen.getByText("No memory records found.")).toBeInTheDocument();

    rerender(
      <MemoryLatticePanel
        filters={{}}
        response={null}
        loading={false}
        error={new Error("Memory Lattice graph fetch failed.")}
        selectedRecordId={null}
        onFiltersChange={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    expect(screen.getByText("Memory Lattice graph fetch failed.")).toBeInTheDocument();
  });

  it("honors reduced-motion preferences", async () => {
    installReducedMotion(true);
    render(
      <MemoryLatticeSurface
        response={graphResponse()}
        loading={false}
        error={null}
        selectedRecordId="record-alpha"
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Memory graph")).toHaveAttribute("data-renderer", "three"));
    expect(screen.getByLabelText("Memory graph")).toHaveAttribute("data-reduced-motion", "true");
  });

  it("does not force loading animation when reduced motion is preferred", () => {
    installReducedMotion(true);
    const { container } = render(
      <MemoryLatticePanel
        filters={{ depth: 1, limit: 25 }}
        response={null}
        loading={true}
        error={null}
        selectedRecordId={null}
        onFiltersChange={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRecord={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Loading Memory Lattice")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });
});
