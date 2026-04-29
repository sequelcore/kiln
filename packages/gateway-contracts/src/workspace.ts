export type OperatorWorkspaceEntryKind = "file" | "directory";

export type OperatorWorkspacePreviewKind = "text" | "image" | "binary" | "unsupported";

export type OperatorWorkspaceVcsState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "ignored"
  | "conflicted";

export interface OperatorWorkspaceVcsStatus {
  readonly provider: "git";
  readonly state: OperatorWorkspaceVcsState;
  readonly staged?: boolean;
}

export interface OperatorWorkspaceTreeEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: OperatorWorkspaceEntryKind;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
  readonly vcs?: OperatorWorkspaceVcsStatus;
}

export interface OperatorWorkspaceDirectorySnapshot {
  readonly rootPath: string;
  readonly directoryPath: string;
  readonly parentPath?: string;
  readonly entries: readonly OperatorWorkspaceTreeEntry[];
  readonly truncated?: boolean;
  readonly source: "gateway";
}

export interface OperatorWorkspaceFileSnapshot {
  readonly path: string;
  readonly name: string;
  readonly kind: OperatorWorkspacePreviewKind;
  readonly sizeBytes: number;
  readonly modifiedAt?: string;
  readonly mimeType?: string;
  readonly language?: string;
  readonly encoding?: "utf-8" | "base64";
  readonly content?: string;
  readonly dataUrl?: string;
  readonly truncated?: boolean;
  readonly unsupportedReason?: string;
  readonly source: "gateway";
}

export type OperatorWorkspaceErrorCode =
  | "workspace_unavailable"
  | "invalid_path"
  | "outside_workspace"
  | "not_found"
  | "not_a_directory"
  | "not_a_file"
  | "read_failed"
  | "preview_unsupported";

export interface OperatorWorkspaceError {
  readonly code: OperatorWorkspaceErrorCode;
  readonly message: string;
  readonly path?: string;
}

export interface OperatorWorkspaceExplorer {
  listDirectory(path?: string): Promise<OperatorWorkspaceDirectorySnapshot>;
  readFile(path: string): Promise<OperatorWorkspaceFileSnapshot>;
}
