import { lazy, Suspense, type ComponentProps } from "react";
import { resolveChatLayout } from "./chat-layout.js";
import { ChatWorkbench } from "./chat-workbench.js";
import { Composer } from "./composer.js";
import type { WorkbenchSurface } from "./workbench-navigation.js";

const ActivityLogPanel = lazy(async () => {
  const module = await import("./activity-log-panel.js");
  return { default: module.ActivityLogPanel };
});
const ManagedAgentCockpitPanel = lazy(async () => {
  const module = await import("./managed-agent-cockpit-panel.js");
  return { default: module.ManagedAgentCockpitPanel };
});
const OperatorSurfaceTabs = lazy(async () => {
  const module = await import("./operator-surface-tabs.js");
  return { default: module.OperatorSurfaceTabs };
});
const Transcript = lazy(async () => {
  const module = await import("./transcript.js");
  return { default: module.Transcript };
});
const SetupPanel = lazy(async () => {
  const module = await import("./setup-panel.js");
  return { default: module.SetupPanel };
});
const WorkItemsPanel = lazy(async () => {
  const module = await import("./work-items-panel.js");
  return { default: module.WorkItemsPanel };
});
const WorkflowOverviewPanel = lazy(async () => {
  const module = await import("./workflow-overview-panel.js");
  return { default: module.WorkflowOverviewPanel };
});
const MemoryLatticePanel = lazy(async () => {
  const module = await import("./memory-lattice/memory-lattice-panel.js");
  return { default: module.MemoryLatticePanel };
});
const MemoryLatticeSurface = lazy(async () => {
  const module = await import("./memory-lattice/memory-lattice-panel.js");
  return { default: module.MemoryLatticeSurface };
});

type ChatWorkbenchProps = ComponentProps<typeof ChatWorkbench>;
type ComposerProps = ComponentProps<typeof Composer>;
type OperatorSurfaceTabsProps = ComponentProps<typeof OperatorSurfaceTabs>;
type TranscriptProps = ComponentProps<typeof Transcript>;
type WorkflowOverviewPanelProps = ComponentProps<typeof WorkflowOverviewPanel>;
type WorkItemsPanelProps = ComponentProps<typeof WorkItemsPanel>;
type ManagedAgentCockpitPanelProps = ComponentProps<typeof ManagedAgentCockpitPanel>;
type ActivityLogPanelProps = ComponentProps<typeof ActivityLogPanel>;
type MemoryLatticePanelProps = ComponentProps<typeof MemoryLatticePanel>;
type SetupPanelProps = ComponentProps<typeof SetupPanel>;

interface WorkbenchSurfacesProps {
  readonly activeSurface: WorkbenchSurface;
  readonly chatWorkbench: Omit<ChatWorkbenchProps, "surfaces" | "composer" | "layout">;
  readonly operatorSurfaceTabs: Omit<OperatorSurfaceTabsProps, "chatContent" | "memoryContent">;
  readonly transcript: TranscriptProps;
  readonly composer: ComposerProps;
  readonly workflowOverview: WorkflowOverviewPanelProps;
  readonly workItems: WorkItemsPanelProps;
  readonly managedAgents: ManagedAgentCockpitPanelProps;
  readonly activityLog: ActivityLogPanelProps;
  readonly memory: MemoryLatticePanelProps;
  readonly setup: SetupPanelProps;
}

function MemoryLatticeFallback() {
  return (
    <section aria-label="Loading Memory Lattice" className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer">
      <div className="flex min-h-12 shrink-0 items-center border-b border-border/60 bg-workspace-viewer-panel px-4">
        <p className="text-sm font-semibold text-foreground">Loading Memory Lattice</p>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-sm text-muted-foreground">
        Preparing graph surface.
      </div>
    </section>
  );
}

function OperatorSurfaceFallback(props: { readonly label: string }) {
  return (
    <section
      aria-label={props.label}
      className="grid min-h-0 flex-1 place-items-center bg-workspace-viewer"
      role="status"
    >
      <p className="text-sm text-muted-foreground">Preparing operator surface.</p>
    </section>
  );
}

export function WorkbenchSurfaces(props: WorkbenchSurfacesProps) {
  if (props.activeSurface === "chat") {
    const layout = resolveChatLayout({
      activeSurface: props.operatorSurfaceTabs.activeSurface,
      conversationEntryCount: props.transcript.entries.length,
      pendingApprovalCount: props.chatWorkbench.pendingApprovals.length,
      hasForegroundGoal: Boolean(props.composer.foregroundGoal),
      sessionStatus: props.composer.status,
    });
    return (
      <ChatWorkbench
        {...props.chatWorkbench}
        layout={layout}
        surfaces={
          <Suspense fallback={<OperatorSurfaceFallback label="Loading conversation" />}>
            <OperatorSurfaceTabs
              {...props.operatorSurfaceTabs}
              chatContent={<Transcript {...props.transcript} />}
              memoryContent={
                <Suspense fallback={<MemoryLatticeFallback />}>
                  <MemoryLatticeSurface {...props.memory} />
                </Suspense>
              }
            />
          </Suspense>
        }
        composer={<Composer {...props.composer} />}
      />
    );
  }

  if (props.activeSurface === "work") {
    return (
      <Suspense fallback={<OperatorSurfaceFallback label="Loading work surface" />}>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(16rem,0.9fr)_minmax(18rem,1.1fr)] overflow-hidden bg-workspace-viewer lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:grid-rows-1">
          <div className="min-h-0 overflow-hidden border-b border-border/70 lg:border-b-0 lg:border-r">
            <WorkflowOverviewPanel {...props.workflowOverview} />
          </div>
          <div className="min-h-0 overflow-hidden">
            <WorkItemsPanel {...props.workItems} />
          </div>
        </div>
      </Suspense>
    );
  }

  if (props.activeSurface === "agents") {
    return (
      <Suspense fallback={<OperatorSurfaceFallback label="Loading managed agents" />}>
        <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
          <ManagedAgentCockpitPanel {...props.managedAgents} />
        </div>
      </Suspense>
    );
  }

  if (props.activeSurface === "activity") {
    return (
      <Suspense fallback={<OperatorSurfaceFallback label="Loading activity" />}>
        <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
          <ActivityLogPanel {...props.activityLog} />
        </div>
      </Suspense>
    );
  }

  if (props.activeSurface === "memory") {
    return (
      <Suspense fallback={<MemoryLatticeFallback />}>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] overflow-hidden bg-workspace-viewer">
          <MemoryLatticePanel {...props.memory} />
          <MemoryLatticeSurface {...props.memory} />
        </div>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<OperatorSurfaceFallback label="Loading setup" />}>
      <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
        <SetupPanel {...props.setup} />
      </div>
    </Suspense>
  );
}
