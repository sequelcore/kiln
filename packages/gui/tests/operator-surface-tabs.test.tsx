import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperatorSurfaceTabs } from "../src/components/operator-surface-tabs.js";

describe("OperatorSurfaceTabs", () => {
  it("keeps chat as the first main-layout tab while rendering open workspace files", () => {
    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[{
          path: "C:/repo/package.json",
          name: "package.json",
          kind: "text",
          sizeBytes: 17,
          source: "gateway",
          encoding: "utf-8",
          language: "json",
          content: "{\"ok\":true}",
        }]}
        selectedPath="C:/repo/package.json"
        loadingPath={null}
        error={null}
        onSelectChat={vi.fn()}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    const operatorSurfaces = screen.getByLabelText("Operator surfaces");
    expect(operatorSurfaces).toBeInTheDocument();
    expect(operatorSurfaces.className).toContain("bg-workspace-viewer");
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Memory Lattice" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "package.json" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-code")).toHaveTextContent(/"ok":\s*true/);
  });

  it("renders the Memory Lattice as a closable main surface tab only after it is opened", () => {
    const onSelectMemory = vi.fn();
    const onCloseMemory = vi.fn();
    render(
      <OperatorSurfaceTabs
        activeSurface="chat"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div data-testid="memory-surface">Memory Lattice canvas</div>}
        memoryOpen
        files={[]}
        selectedPath={null}
        loadingPath={null}
        error={null}
        onSelectChat={vi.fn()}
        onSelectMemory={onSelectMemory}
        onCloseMemory={onCloseMemory}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Memory Lattice" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Memory Lattice" }));

    expect(onSelectMemory).toHaveBeenCalledOnce();
    expect(onCloseMemory).toHaveBeenCalledOnce();
  });

  it("renders markdown through the safe markdown renderer", () => {
    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[{
          path: "C:/repo/README.md",
          name: "README.md",
          kind: "text",
          sizeBytes: 32,
          source: "gateway",
          encoding: "utf-8",
          language: "md",
          mimeType: "text/markdown",
          content: "# Kiln\n\n- governed workspace",
        }]}
        selectedPath="C:/repo/README.md"
        loadingPath={null}
        error={null}
        onSelectChat={vi.fn()}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Kiln" })).toBeInTheDocument();
    expect(screen.getByText("governed workspace")).toBeInTheDocument();
  });

  it("switches back to chat without closing open file tabs", () => {
    const onSelectChat = vi.fn();
    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[{
          path: "C:/repo/src/index.ts",
          name: "index.ts",
          kind: "text",
          sizeBytes: 22,
          source: "gateway",
          encoding: "utf-8",
          language: "ts",
          content: "export const ok = true;",
        }]}
        selectedPath="C:/repo/src/index.ts"
        loadingPath={null}
        error={null}
        onSelectChat={onSelectChat}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect(onSelectChat).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "index.ts" })).toBeInTheDocument();
  });

  it("keeps the selected file tab visible when preview loading fails", () => {
    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[]}
        selectedPath="C:/repo/missing.ts"
        loadingPath={null}
        error="Workspace file was not found."
        onSelectChat={vi.fn()}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText("missing.ts")).toBeInTheDocument();
    expect(screen.getByText("Workspace file was not found.")).toBeInTheDocument();
  });

  it("constrains long workspace file names inside closable tabs", () => {
    const longName = "very-long-generated-workspace-document-name-that-should-not-overflow-the-tab-boundary.tsx";
    const longPath = `C:/repo/src/components/${longName}`;

    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[{
          path: longPath,
          name: longName,
          kind: "text",
          sizeBytes: 22,
          source: "gateway",
          encoding: "utf-8",
          language: "tsx",
          content: "export const ok = true;",
        }]}
        selectedPath={longPath}
        loadingPath={null}
        error={null}
        onSelectChat={vi.fn()}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    const tab = screen.getByRole("tab", { name: longName });
    const tabShell = tab.parentElement;
    const label = screen.getByText(longName);

    expect(tab).toHaveAttribute("title", longPath);
    expect(tab.className).toContain("min-w-0");
    expect(tab.className).toContain("flex-1");
    expect(tab.className).toContain("overflow-hidden");
    expect(tabShell?.className).toContain("max-w-60");
    expect(tabShell?.className).toContain("overflow-hidden");
    expect(label.className).toContain("truncate");
    expect(screen.getByRole("button", { name: `Close ${longName}` })).toBeInTheDocument();
  });

  it("contains long code lines inside the viewer scroll boundary", () => {
    const longLine = `export const value = "${"x".repeat(400)}";`;

    render(
      <OperatorSurfaceTabs
        activeSurface="workspace"
        chatContent={<div>Chat transcript</div>}
        memoryContent={<div>Memory Lattice surface</div>}
        memoryOpen={false}
        files={[{
          path: "C:/repo/src/long-line.ts",
          name: "long-line.ts",
          kind: "text",
          sizeBytes: longLine.length,
          source: "gateway",
          encoding: "utf-8",
          language: "ts",
          content: longLine,
        }]}
        selectedPath="C:/repo/src/long-line.ts"
        loadingPath={null}
        error={null}
        onSelectChat={vi.fn()}
        onSelectMemory={vi.fn()}
        onCloseMemory={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    const workspaceDocuments = screen.getByLabelText("Operator surfaces");
    const scrollBoundary = screen.getByTestId("workspace-code-scroll");
    const selectedPanel = screen.getByRole("tabpanel", { name: "long-line.ts" });

    expect(workspaceDocuments.className).toContain("min-w-0");
    expect(workspaceDocuments.className).toContain("overflow-hidden");
    expect(selectedPanel.className).toContain("min-w-0");
    expect(selectedPanel.className).toContain("overflow-hidden");
    expect(scrollBoundary.className).toContain("min-w-0");
    expect(scrollBoundary.className).toContain("overflow-auto");
    expect(screen.getByTestId("workspace-code")).toHaveTextContent("export const value");
  });
});
