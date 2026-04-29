import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type {
  GuiDashboardSnapshot,
  OperatorWorkspaceDirectorySnapshot,
  OperatorWorkspaceTreeEntry,
  OperatorWorkspaceVcsStatus,
} from "@kilnai/gateway-contracts";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";
import { cn } from "@/lib/utils";

interface WorkspaceExplorerClient {
  loadWorkspaceDirectory(path?: string): Promise<OperatorWorkspaceDirectorySnapshot>;
}

interface WorkspacePanelProps {
  readonly gatewayWorkingDirectory?: string;
  readonly workspaceTree?: GuiDashboardSnapshot["workspaceTree"];
  readonly workspaceClient?: WorkspaceExplorerClient;
  readonly worktreePath?: string | null;
  readonly selectedFilePath?: string | null;
  readonly onOpenFile?: (entry: OperatorWorkspaceTreeEntry) => void;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function seedSnapshot(snapshot: GuiDashboardSnapshot["workspaceTree"]): OperatorWorkspaceDirectorySnapshot | null {
  if (!snapshot) return null;
  return {
    rootPath: snapshot.rootPath,
    directoryPath: snapshot.rootPath,
    entries: snapshot.entries,
    truncated: snapshot.truncated,
    source: "gateway",
  };
}

function vcsLabel(vcs: OperatorWorkspaceVcsStatus): string {
  switch (vcs.state) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "?";
    case "ignored": return "I";
    case "conflicted": return "!";
  }
}

function vcsTitle(vcs: OperatorWorkspaceVcsStatus): string {
  return `${vcs.staged ? "staged " : ""}${vcs.state}`;
}

function vcsTextClass(vcs: OperatorWorkspaceVcsStatus): string {
  switch (vcs.state) {
    case "conflicted": return "text-destructive";
    case "deleted": return "text-destructive/85";
    case "added": return "text-[var(--color-success)]";
    case "modified":
    case "renamed": return "text-[var(--color-accent)]";
    case "untracked":
    case "ignored": return "text-muted-foreground/60";
  }
}

function WorkspaceTreeRow(props: {
  readonly entry: OperatorWorkspaceTreeEntry;
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly onToggleDirectory: (entry: OperatorWorkspaceTreeEntry) => void;
  readonly onOpenFile: (entry: OperatorWorkspaceTreeEntry) => void;
}) {
  const isDirectory = props.entry.kind === "directory";
  return (
    <button
      type="button"
      onClick={() => {
        if (isDirectory) props.onToggleDirectory(props.entry);
        else props.onOpenFile(props.entry);
      }}
      className={cn(
        "grid w-full grid-cols-[1rem_1rem_minmax(0,1fr)_1.5rem] items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        props.selected ? "bg-secondary/70" : "hover:bg-secondary/35",
        props.entry.vcs ? vcsTextClass(props.entry.vcs) : "text-foreground",
      )}
      style={{ paddingLeft: `${0.5 + props.depth * 0.875}rem` }}
      aria-label={`${isDirectory ? "Folder" : "File"} ${props.entry.name}`}
    >
      <span className="text-muted-foreground">
        {isDirectory ? (props.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />) : null}
      </span>
      <span className="text-muted-foreground">
        {isDirectory ? <Folder className="size-3.5" /> : <File className="size-3.5" />}
      </span>
      <span className="min-w-0 truncate font-mono text-[12px] leading-5">{props.entry.name}</span>
      {props.entry.vcs ? (
        <span
          className={cn("justify-self-end rounded border border-current/30 px-1 font-mono text-[10px] leading-4", vcsTextClass(props.entry.vcs))}
          title={vcsTitle(props.entry.vcs)}
          aria-label={`Git ${vcsTitle(props.entry.vcs)}`}
        >
          {vcsLabel(props.entry.vcs)}
        </span>
      ) : null}
    </button>
  );
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const initialSnapshot = useMemo(() => seedSnapshot(props.workspaceTree), [props.workspaceTree]);
  const [directoryByPath, setDirectoryByPath] = useState<ReadonlyMap<string, OperatorWorkspaceDirectorySnapshot>>(() => {
    const next = new Map<string, OperatorWorkspaceDirectorySnapshot>();
    if (initialSnapshot) next.set(initialSnapshot.directoryPath, initialSnapshot);
    return next;
  });
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set(initialSnapshot ? [initialSnapshot.directoryPath] : []));
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSnapshot) return;
    setDirectoryByPath((current) => {
      const next = new Map(current);
      next.set(initialSnapshot.directoryPath, initialSnapshot);
      return next;
    });
    setExpandedPaths((current) => new Set([...current, initialSnapshot.directoryPath]));
  }, [initialSnapshot]);

  const rootSnapshot = initialSnapshot ? directoryByPath.get(initialSnapshot.directoryPath) ?? initialSnapshot : null;
  const workspaceRoot = rootSnapshot?.rootPath ?? props.gatewayWorkingDirectory ?? null;
  const worktreePath = props.worktreePath && props.worktreePath !== workspaceRoot ? props.worktreePath : null;

  const toggleDirectory = async (entry: OperatorWorkspaceTreeEntry) => {
    if (expandedPaths.has(entry.path)) {
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    setExpandedPaths((current) => new Set([...current, entry.path]));
    setTreeError(null);
    if (!directoryByPath.has(entry.path) && props.workspaceClient) {
      setLoadingPath(entry.path);
      try {
        const snapshot = await props.workspaceClient.loadWorkspaceDirectory(entry.path);
        setDirectoryByPath((current) => {
          const next = new Map(current);
          next.set(snapshot.directoryPath, snapshot);
          return next;
        });
      } catch (error) {
        setTreeError(error instanceof Error ? error.message : "Could not load workspace directory.");
      } finally {
        setLoadingPath(null);
      }
    }
  };

  const renderEntries = (snapshot: OperatorWorkspaceDirectorySnapshot | null, depth = 0): ReactElement[] => {
    if (!snapshot) return [];
    return snapshot.entries.flatMap((entry) => {
      const childSnapshot = directoryByPath.get(entry.path) ?? null;
      const expanded = expandedPaths.has(entry.path);
      return [
        <WorkspaceTreeRow
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={expanded}
          selected={props.selectedFilePath === entry.path}
          onToggleDirectory={toggleDirectory}
          onOpenFile={(fileEntry) => props.onOpenFile?.(fileEntry)}
        />,
        ...(entry.kind === "directory" && expanded ? renderEntries(childSnapshot, depth + 1) : []),
      ];
    });
  };

  return (
    <SidebarPanelShell title="Workspace" meta={rootSnapshot ? "explorer" : "metadata"}>
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-border/60 px-3 py-2">
          {workspaceRoot ? (
            <div aria-label="Workspace root" className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Root</p>
              <p className="mt-1 truncate font-mono text-[12px] leading-5 text-foreground" title={normalizePath(workspaceRoot)}>
                {normalizePath(workspaceRoot)}
              </p>
              {worktreePath ? (
                <p className="mt-1 truncate font-mono text-[11px] leading-5 text-muted-foreground" title={normalizePath(worktreePath)}>
                  worktree: {normalizePath(worktreePath)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">No working directory available.</p>
          )}
        </div>

        <section aria-label="Workspace tree" className="min-h-0 overflow-y-auto border-b border-border/60">
          {rootSnapshot ? (
            <div>
              <div aria-label="Workspace files">{renderEntries(rootSnapshot)}</div>
              {loadingPath ? <p className="px-3 py-2 text-xs text-muted-foreground">Loading {normalizePath(loadingPath)}...</p> : null}
              {treeError ? <p className="px-3 py-2 text-xs text-destructive">{treeError}</p> : null}
              {rootSnapshot.truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">Showing first {rootSnapshot.entries.length} entries.</p> : null}
            </div>
          ) : (
            <p className="p-4 text-sm leading-6 text-muted-foreground">No workspace tree available.</p>
          )}
        </section>

      </div>
    </SidebarPanelShell>
  );
}
