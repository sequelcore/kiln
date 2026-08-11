import type { ComponentProps } from "react";
import { ApprovalsPanel } from "./approvals-panel.js";
import { ChangedFilesPanel } from "./changed-files-panel.js";
import { WorkspacePanel } from "./workspace-panel.js";
import type { InspectorMode } from "./workbench-navigation.js";

type WorkspacePanelProps = ComponentProps<typeof WorkspacePanel>;
type ChangedFilesPanelProps = ComponentProps<typeof ChangedFilesPanel>;
type ApprovalsPanelProps = ComponentProps<typeof ApprovalsPanel>;

export function WorkbenchInspectorPanel(props: {
  readonly mode: InspectorMode;
  readonly gatewayWorkingDirectory: WorkspacePanelProps["gatewayWorkingDirectory"];
  readonly workspaceLoadError?: WorkspacePanelProps["loadError"];
  readonly onRetryWorkspaceLoad?: WorkspacePanelProps["onRetryLoad"];
  readonly workspaceTree: WorkspacePanelProps["workspaceTree"];
  readonly workspaceClient: WorkspacePanelProps["workspaceClient"];
  readonly worktreePath: WorkspacePanelProps["worktreePath"];
  readonly selectedFilePath: WorkspacePanelProps["selectedFilePath"];
  readonly changedFiles: ChangedFilesPanelProps["files"];
  readonly approvals: ApprovalsPanelProps["approvals"];
  readonly approvalResponseFailure?: ApprovalsPanelProps["responseFailure"];
  readonly onOpenFile: NonNullable<WorkspacePanelProps["onOpenFile"]>;
  readonly onApprove: (approvalId: string) => void;
  readonly onDeny: (approvalId: string) => void;
}) {
  if (props.mode === "workspace") {
    return (
      <WorkspacePanel
        loadError={props.workspaceLoadError}
        onRetryLoad={props.onRetryWorkspaceLoad}
        gatewayWorkingDirectory={props.gatewayWorkingDirectory}
        workspaceTree={props.workspaceTree}
        workspaceClient={props.workspaceClient}
        worktreePath={props.worktreePath}
        selectedFilePath={props.selectedFilePath}
        onOpenFile={props.onOpenFile}
      />
    );
  }

  if (props.mode === "changed") {
    return <ChangedFilesPanel files={props.changedFiles} />;
  }

  return (
    <ApprovalsPanel
      approvals={props.approvals}
      responseFailure={props.approvalResponseFailure}
      onApprove={props.onApprove}
      onDeny={props.onDeny}
    />
  );
}
