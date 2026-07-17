import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceDocuments } from "../src/components/use-workspace-documents.js";

describe("useWorkspaceDocuments", () => {
  it("opens, selects, and closes workspace documents", async () => {
    const gatewayClient = {
      loadWorkspaceFile: vi.fn(async (path: string) => ({
        path,
        content: `content:${path}`,
        mimeType: "text/plain",
        encoding: "utf8",
      })),
    };
    const onLastDocumentClosed = vi.fn();
    const { result } = renderHook(() => useWorkspaceDocuments({
      gatewayClient: gatewayClient as never,
      onError: vi.fn(),
      onLastDocumentClosed,
    }));

    await act(async () => {
      await result.current.openFile({ kind: "file", path: "src/a.ts", name: "a.ts" });
    });

    expect(result.current.documents).toHaveLength(1);
    expect(result.current.selectedPath).toBe("src/a.ts");

    act(() => {
      result.current.selectPath("src/a.ts");
      result.current.closeFile("src/a.ts");
    });

    expect(result.current.documents).toHaveLength(0);
    expect(result.current.selectedPath).toBeNull();
    expect(onLastDocumentClosed).toHaveBeenCalledTimes(1);
  });

  it("surfaces load failures through local and global error channels", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useWorkspaceDocuments({
      gatewayClient: {
        loadWorkspaceFile: vi.fn(async () => {
          throw new Error("No file");
        }),
      } as never,
      onError,
      onLastDocumentClosed: vi.fn(),
    }));

    await act(async () => {
      await result.current.openFile({ kind: "file", path: "missing.ts", name: "missing.ts" });
    });

    expect(result.current.error).toBe("No file");
    expect(onError).toHaveBeenCalledWith("No file");
  });
});
