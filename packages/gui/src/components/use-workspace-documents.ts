import { useState } from "react";
import type {
  OperatorWorkspaceFileSnapshot,
  OperatorWorkspaceTreeEntry,
} from "@kilnai/gateway-contracts";
import type { GuiGatewayClient } from "../api/client.js";

const WORKSPACE_DOCUMENT_TAB_LIMIT = 8;

export function useWorkspaceDocuments(input: {
  readonly gatewayClient: GuiGatewayClient;
  readonly onLastDocumentClosed: () => void;
}) {
  const [documents, setDocuments] = useState<readonly OperatorWorkspaceFileSnapshot[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openFile = async (entry: OperatorWorkspaceTreeEntry) => {
    setSelectedPath(entry.path);
    setError(null);
    if (documents.some((file) => file.path === entry.path)) {
      return;
    }
    setLoadingPath(entry.path);
    try {
      const file = await input.gatewayClient.loadWorkspaceFile(entry.path);
      setDocuments((current) => [file, ...current.filter((item) => item.path !== file.path)].slice(0, WORKSPACE_DOCUMENT_TAB_LIMIT));
      setSelectedPath(file.path);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load workspace file.";
      setError(message);
    } finally {
      setLoadingPath(null);
    }
  };

  const closeFile = (path: string) => {
    const next = documents.filter((file) => file.path !== path);
    setDocuments(next);
    if (selectedPath === path) {
      setSelectedPath(next[0]?.path ?? null);
      if (next.length === 0) {
        input.onLastDocumentClosed();
      }
    }
  };

  const clearSelection = () => {
    setSelectedPath(null);
    setError(null);
  };

  const selectPath = (path: string) => {
    setSelectedPath(path);
    setError(null);
  };

  return {
    documents,
    selectedPath,
    loadingPath,
    error,
    openFile,
    closeFile,
    clearSelection,
    selectPath,
  };
}
