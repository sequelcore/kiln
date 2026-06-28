import { lazy, Suspense, type ComponentProps } from "react";
import { ActivityLogPanel } from "./activity-log-panel.js";
import { ChatWorkbench } from "./chat-workbench.js";
import { Composer } from "./composer.js";
import { ManagedAgentCockpitPanel } from "./managed-agent-cockpit-panel.js";
import { OperatorSurfaceTabs } from "./operator-surface-tabs.js";
import { SetupPanel } from "./setup-panel.js";
import { Transcript } from "./transcript.js";
import { WorkItemsPanel } from "./work-items-panel.js";
import { WorkflowOverviewPanel } from "./workflow-overview-panel.js";
import type { WorkbenchSurface } from "./workbench-navigation.js";

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
  readonly chatWorkbench: Omit<ChatWorkbenchProps, "surfaces" | "composer">;
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

export function WorkbenchSurfaces(props: WorkbenchSurfacesProps) {
  if (props.activeSurface === "chat") {
    return (
      <ChatWorkbench
        {...props.chatWorkbench}
        surfaces={(
          <OperatorSurfaceTabs
            {...props.operatorSurfaceTabs}
            chatContent={<Transcript {...props.transcript} />}
            memoryContent={(
              <Suspense fallback={<MemoryLatticeFallback />}>
                <MemoryLatticeSurface {...props.memory} />
              </Suspense>
            )}
          />
        )}
        composer={<Composer {...props.composer} />}
      />
    );
  }

  if (props.activeSurface === "work") {
    return (
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(16rem,0.9fr)_minmax(18rem,1.1fr)] overflow-hidden bg-workspace-viewer lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:grid-rows-1">
        <div className="min-h-0 overflow-hidden border-b border-border/70 lg:border-b-0 lg:border-r">
          <WorkflowOverviewPanel {...props.workflowOverview} />
        </div>
        <div className="min-h-0 overflow-hidden">
          <WorkItemsPanel {...props.workItems} />
        </div>
      </div>
    );
  }

  if (props.activeSurface === "agents") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
        <ManagedAgentCockpitPanel {...props.managedAgents} />
      </div>
    );
  }

  if (props.activeSurface === "activity") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
        <ActivityLogPanel {...props.activityLog} />
      </div>
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
    <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
      <SetupPanel {...props.setup} />
    </div>
  );
}
