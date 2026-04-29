import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceDocumentTabs } from "../src/components/workspace-document-tabs.js";

describe("WorkspaceDocumentTabs", () => {
  it("keeps chat as the first main-layout tab while rendering open workspace files", () => {
    render(
      <WorkspaceDocumentTabs
        chatContent={<div>Chat transcript</div>}
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
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    const workspaceDocuments = screen.getByLabelText("Workspace documents");
    expect(workspaceDocuments).toBeInTheDocument();
    expect(workspaceDocuments.className).toContain("bg-workspace-viewer");
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "package.json" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-code")).toHaveTextContent(/"ok":\s*true/);
  });

  it("renders markdown through the safe markdown renderer", () => {
    render(
      <WorkspaceDocumentTabs
        chatContent={<div>Chat transcript</div>}
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
      <WorkspaceDocumentTabs
        chatContent={<div>Chat transcript</div>}
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
      <WorkspaceDocumentTabs
        chatContent={<div>Chat transcript</div>}
        files={[]}
        selectedPath="C:/repo/missing.ts"
        loadingPath={null}
        error="Workspace file was not found."
        onSelectChat={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText("missing.ts")).toBeInTheDocument();
    expect(screen.getByText("Workspace file was not found.")).toBeInTheDocument();
  });
});
