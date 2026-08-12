import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  CheckCheck,
  FileDiff,
  Folder,
  History,
  ListChecks,
  MessagesSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  clampSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "./sidebar-layout.js";

const KILN_LOGO_URL = new URL("../../../../docs/assets/logo.svg", import.meta.url).href;

export type WorkbenchSurface = "chat" | "work" | "agents" | "activity" | "memory";
export type InspectorMode = "workspace" | "changed" | "approvals";
export type MobileDrawerMode = "sessions" | "inspector";
export type ChatWorkspaceSurface = "chat" | "browser";

const PRIMARY_WORK_SURFACES: readonly WorkbenchSurface[] = [
  "chat",
  "work",
  "agents",
];

const UTILITY_SURFACES: readonly WorkbenchSurface[] = [
  "activity",
  "memory",
];

const WORKBENCH_SURFACES: readonly WorkbenchSurface[] = [
  ...PRIMARY_WORK_SURFACES,
  ...UTILITY_SURFACES,
];

const INSPECTOR_MODES: readonly InspectorMode[] = [
  "workspace",
  "changed",
  "approvals",
];

const WORKBENCH_SURFACE_LABELS: Record<WorkbenchSurface, string> = {
  chat: "Chat",
  work: "Work",
  agents: "Agents",
  activity: "Activity",
  memory: "Memory",
};

const WORKBENCH_SURFACE_DESCRIPTIONS: Record<WorkbenchSurface, string> = {
  chat: "conversation",
  work: "governed work items",
  agents: "managed children",
  activity: "runtime timeline",
  memory: "memory lattice",
};

const INSPECTOR_LABELS: Record<InspectorMode, string> = {
  workspace: "Workspace",
  changed: "Changed",
  approvals: "Approvals",
};

const INSPECTOR_ARIA_LABELS: Record<InspectorMode, string> = {
  workspace: "Workspace",
  changed: "Changed files",
  approvals: "Approvals",
};

const workbenchSurfaceIcons: Record<WorkbenchSurface, LucideIcon> = {
  chat: MessagesSquare,
  work: ListChecks,
  agents: Bot,
  activity: Activity,
  memory: Network,
};

const inspectorModeIcons: Record<InspectorMode, LucideIcon> = {
  workspace: Folder,
  changed: FileDiff,
  approvals: CheckCheck,
};

function KilnMark() {
  return (
    <div className="grid size-9 shrink-0 place-items-center" aria-hidden="true">
      <img
        src={KILN_LOGO_URL}
        alt=""
        className="size-7 object-contain"
        draggable={false}
      />
    </div>
  );
}

function getWorkbenchDescription(surface: WorkbenchSurface, chatSurface: ChatWorkspaceSurface): string {
  if (surface === "chat") {
    return chatSurface === "browser" ? "interactive browser" : WORKBENCH_SURFACE_DESCRIPTIONS.chat;
  }
  return WORKBENCH_SURFACE_DESCRIPTIONS[surface];
}

function NavButton(props: {
  readonly label: string;
  readonly active: boolean;
  readonly count?: number;
  readonly icon: LucideIcon;
  readonly collapsed?: boolean;
  readonly onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <Button
      type="button"
      variant={props.active ? "secondary" : "ghost"}
      size={props.collapsed ? "icon-lg" : "sm"}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "relative overflow-hidden text-muted-foreground",
        props.collapsed ? "w-full" : "h-8 w-full justify-start px-2",
        props.active && "bg-muted/70 text-foreground",
      )}
    >
      {props.active ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute rounded-full bg-[var(--color-accent)]",
            props.collapsed ? "left-1 top-1/2 h-4 w-0.5 -translate-y-1/2" : "left-0 top-2 h-4 w-0.5",
          )}
        />
      ) : null}
      <Icon data-icon="inline-start" aria-hidden="true" />
      {props.collapsed ? null : <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>}
      {props.count && props.count > 0 ? (
        <Badge
          variant="outline"
          className={cn(
            "h-4 min-w-4 px-1 font-mono text-[9px] leading-none text-muted-foreground",
            props.collapsed && "absolute -right-1 -top-1",
          )}
        >
          {props.count}
        </Badge>
      ) : null}
    </Button>
  );
}

function renderSidebarSurfaceButtons(props: {
  readonly surfaces: readonly WorkbenchSurface[];
  readonly activeSurface: WorkbenchSurface;
  readonly collapsed: boolean;
  readonly activityCount: number;
  readonly managedAgentAttentionCount: number;
  readonly onSelectSurface: (surface: WorkbenchSurface) => void;
}): ReactNode {
  return props.surfaces.map((surface) => (
    <NavButton
      key={surface}
      label={WORKBENCH_SURFACE_LABELS[surface]}
      icon={workbenchSurfaceIcons[surface]}
      active={props.activeSurface === surface}
      count={surface === "agents"
        ? props.managedAgentAttentionCount
        : surface === "activity"
          ? props.activityCount
          : undefined}
      collapsed={props.collapsed}
      onClick={() => props.onSelectSurface(surface)}
    />
  ));
}

export function PrimarySidebar(props: {
  readonly activeSurface: WorkbenchSurface;
  readonly collapsed: boolean;
  readonly sidebarWidth: number;
  readonly activityCount: number;
  readonly managedAgentAttentionCount: number;
  readonly sessionsOpen: boolean;
  readonly onSelectSurface: (surface: WorkbenchSurface) => void;
  readonly onToggleCollapsed: () => void;
  readonly onSidebarWidthChange: (width: number, persist: boolean) => void;
  readonly onSessionsOpenChange: (open: boolean) => void;
  readonly onStartNewSession: () => void;
  readonly onOpenSettings: () => void;
  readonly sessions: ReactNode;
}) {
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    latestWidth: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStep = 16;

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: props.sidebarWidth,
      latestWidth: props.sidebarWidth,
    };
    setResizing(true);
  };
  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextWidth = clampSidebarWidth(state.startWidth + event.clientX - state.startX);
    state.latestWidth = nextWidth;
    props.onSidebarWidthChange(nextWidth, false);
  };
  const handleResizePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    props.onSidebarWidthChange(state.latestWidth, true);
  };
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? resizeStep * 4 : resizeStep;
    const nextWidth = event.key === "ArrowRight"
      ? props.sidebarWidth + step
      : event.key === "ArrowLeft"
        ? props.sidebarWidth - step
        : event.key === "Home"
          ? MIN_SIDEBAR_WIDTH
          : event.key === "End"
            ? MAX_SIDEBAR_WIDTH
            : null;
    if (nextWidth === null) return;
    event.preventDefault();
    props.onSidebarWidthChange(clampSidebarWidth(nextWidth), true);
  };

  return (
    <aside
      aria-label="Kiln workspace sidebar"
      className={cn(
        "relative flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        resizing ? "transition-none" : "transition-[width,min-width,max-width]",
        props.collapsed ? "w-14 min-w-14 max-w-14" : undefined,
      )}
      style={props.collapsed ? undefined : {
        width: `${props.sidebarWidth}px`,
        minWidth: `${props.sidebarWidth}px`,
        maxWidth: `${props.sidebarWidth}px`,
      }}
    >
      {!props.collapsed ? (
        <div
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={props.sidebarWidth}
          tabIndex={0}
          className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none outline-none focus-visible:bg-sidebar-ring/70"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onKeyDown={handleResizeKeyDown}
        />
      ) : null}
      <header className={cn("flex min-h-12 items-center px-2", props.collapsed ? "justify-center" : "gap-2")}>
        {props.collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={props.onToggleCollapsed}
          >
            <PanelLeftOpen data-icon="inline-start" aria-hidden="true" />
          </Button>
        ) : (
          <>
            <KilnMark />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">Kiln</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={props.onToggleCollapsed}
            >
              <PanelLeftClose data-icon="inline-start" aria-hidden="true" />
            </Button>
          </>
        )}
      </header>
      <div className="px-2 pb-1">
        <Button
          type="button"
          variant="ghost"
          size={props.collapsed ? "icon-lg" : "sm"}
          aria-label="New session"
          title="New session"
          onClick={props.onStartNewSession}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            props.collapsed ? "w-full" : "h-8 w-full justify-start px-2",
          )}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          {props.collapsed ? null : <span>New session</span>}
        </Button>
      </div>
      <nav aria-label="Primary work surfaces" className="px-2 pb-2">
        <div className="flex flex-col gap-1">
          {renderSidebarSurfaceButtons({
            surfaces: PRIMARY_WORK_SURFACES,
            activeSurface: props.activeSurface,
            collapsed: props.collapsed,
            activityCount: props.activityCount,
            managedAgentAttentionCount: props.managedAgentAttentionCount,
            onSelectSurface: props.onSelectSurface,
          })}
        </div>
      </nav>
      {props.collapsed ? (
        <div className="px-2 pb-2">
          <Popover open={props.sessionsOpen} onOpenChange={props.onSessionsOpenChange}>
            <PopoverTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Open sessions"
                  title="Open sessions"
                  className="relative w-full text-muted-foreground"
                >
                  <History data-icon="inline-start" aria-hidden="true" />
                </Button>
              )}
            />
            <PopoverContent
              aria-label="Sessions"
              side="right"
              align="start"
              sideOffset={8}
              className="h-[min(42rem,calc(100vh-2rem))] w-[18rem] overflow-hidden border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <div className="min-h-0 flex-1">{props.sessions}</div>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{props.sessions}</div>
      )}
      {props.collapsed ? <div className="min-h-0 flex-1" aria-hidden="true" /> : null}
      <nav aria-label="Inspect and configure" className="border-t border-sidebar-border/70 px-2 py-2">
        <div className="flex flex-col gap-1">
          {renderSidebarSurfaceButtons({
            surfaces: UTILITY_SURFACES,
            activeSurface: props.activeSurface,
            collapsed: props.collapsed,
            activityCount: props.activityCount,
            managedAgentAttentionCount: props.managedAgentAttentionCount,
            onSelectSurface: props.onSelectSurface,
          })}
          <NavButton
            label="Settings"
            icon={Settings2}
            active={false}
            collapsed={props.collapsed}
            onClick={props.onOpenSettings}
          />
        </div>
      </nav>
    </aside>
  );
}

export function MobileWorkbenchHeader(props: {
  readonly activeSurface: WorkbenchSurface;
  readonly drawerOpen: boolean;
  readonly drawerMode: MobileDrawerMode;
  readonly gatewayTargetSelector?: ReactNode;
  readonly operatorTerminalAvailable: boolean;
  readonly operatorTerminalExpanded: boolean;
  readonly operatorTerminalPanelId: string;
  readonly onToggleDrawer: (mode: MobileDrawerMode) => void;
  readonly onSelectSurface: (surface: WorkbenchSurface) => void;
  readonly onStartNewSession: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleOperatorTerminal: () => void;
}) {
  return (
    <header className="flex min-w-0 shrink-0 flex-col border-b border-border/70 bg-workspace-viewer-panel px-2 sm:h-11 sm:flex-row sm:items-center sm:gap-2 sm:px-3">
      <div className="flex h-11 min-w-0 items-center gap-1 sm:contents">
        <div className="hidden sm:block">
          <KilnMark />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="New session"
          title="New session"
          onClick={props.onStartNewSession}
          className="[@media(pointer:coarse)]:size-11"
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-controls="session-drawer"
          aria-expanded={props.drawerOpen && props.drawerMode === "sessions"}
          aria-label={props.drawerOpen && props.drawerMode === "sessions" ? "Hide session drawer" : "Open session drawer"}
          title="Sessions"
          onClick={() => props.onToggleDrawer("sessions")}
          className="[@media(pointer:coarse)]:size-11"
        >
          <History data-icon="inline-start" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-controls="session-drawer"
          aria-expanded={props.drawerOpen && props.drawerMode === "inspector"}
          aria-label={props.drawerOpen && props.drawerMode === "inspector" ? "Hide inspector drawer" : "Open inspector drawer"}
          title="Inspector"
          onClick={() => props.onToggleDrawer("inspector")}
          className="[@media(pointer:coarse)]:size-11"
        >
          {props.drawerOpen && props.drawerMode === "inspector" ? (
            <PanelRightClose data-icon="inline-start" aria-hidden="true" />
          ) : (
            <PanelRightOpen data-icon="inline-start" aria-hidden="true" />
          )}
        </Button>
        <Select
          value={props.activeSurface}
          onValueChange={(value) => {
            if (WORKBENCH_SURFACES.includes(value as WorkbenchSurface)) {
              props.onSelectSurface(value as WorkbenchSurface);
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Workbench surface"
            className="h-9 min-w-16 flex-1 sm:min-w-28 sm:flex-none [@media(pointer:coarse)]:h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectLabel>Work surfaces</SelectLabel>
              {PRIMARY_WORK_SURFACES.map((surface) => (
                <SelectItem key={surface} value={surface}>
                  {WORKBENCH_SURFACE_LABELS[surface]}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Inspect and configure</SelectLabel>
              {UTILITY_SURFACES.map((surface) => (
                <SelectItem key={surface} value={surface}>
                  {WORKBENCH_SURFACE_LABELS[surface]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="hidden sm:ml-auto sm:block" />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Settings"
          title="Settings"
          onClick={props.onOpenSettings}
          className="[@media(pointer:coarse)]:size-11"
        >
          <Settings2 aria-hidden="true" />
        </Button>
        {props.operatorTerminalAvailable ? (
          <Button
            id="operator-terminal-trigger"
            type="button"
            variant={props.operatorTerminalExpanded ? "secondary" : "ghost"}
            size="icon-lg"
            aria-controls={props.operatorTerminalPanelId}
            aria-expanded={props.operatorTerminalExpanded}
            aria-label={props.operatorTerminalExpanded ? "Hide terminal" : "Open terminal"}
            title="Terminal (Ctrl+`)"
            onClick={props.onToggleOperatorTerminal}
            className="[@media(pointer:coarse)]:size-11"
          >
            <SquareTerminal aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="empty:hidden w-full min-w-0 pb-2 sm:w-auto sm:pb-0 [&>div]:w-full sm:[&>div]:w-auto [&_[data-slot=select-trigger]]:h-9 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:min-w-0 sm:[&_[data-slot=select-trigger]]:w-36 sm:[&_[data-slot=select-trigger]]:max-w-48 [@media(pointer:coarse)]:[&_[data-slot=select-trigger]]:h-11">
        {props.gatewayTargetSelector}
      </div>
    </header>
  );
}

export function DesktopWorkbenchHeader(props: {
  readonly title: string;
  readonly activeSurface: WorkbenchSurface;
  readonly activeChatSurface: ChatWorkspaceSurface;
  readonly inspectorOpen: boolean;
  readonly inspectorMode: InspectorMode;
  readonly changedCount: number;
  readonly approvalCount: number;
  readonly gatewayTargetSelector?: ReactNode;
  readonly operatorTerminalAvailable: boolean;
  readonly operatorTerminalExpanded: boolean;
  readonly operatorTerminalPanelId: string;
  readonly onSelectInspectorMode: (mode: InspectorMode) => void;
  readonly onToggleInspector: () => void;
  readonly onToggleOperatorTerminal: () => void;
}) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-workspace-viewer-panel px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{props.title}</p>
        <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
          {getWorkbenchDescription(props.activeSurface, props.activeChatSurface)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {props.operatorTerminalAvailable ? (
          <Button
            id="operator-terminal-trigger"
            type="button"
            variant={props.operatorTerminalExpanded ? "secondary" : "ghost"}
            size="sm"
            aria-controls={props.operatorTerminalPanelId}
            aria-expanded={props.operatorTerminalExpanded}
            aria-label={props.operatorTerminalExpanded ? "Hide terminal" : "Open terminal"}
            title="Terminal (Ctrl+`)"
            onClick={props.onToggleOperatorTerminal}
          >
            <SquareTerminal data-icon="inline-start" aria-hidden="true" />
            Terminal
          </Button>
        ) : null}
        {INSPECTOR_MODES.map((mode) => {
          const Icon = inspectorModeIcons[mode];
          return (
            <Button
              key={mode}
              type="button"
              variant={props.inspectorOpen && props.inspectorMode === mode ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={props.inspectorOpen && props.inspectorMode === mode}
              aria-label={INSPECTOR_ARIA_LABELS[mode]}
              onClick={() => props.onSelectInspectorMode(mode)}
            >
              <Icon data-icon="inline-start" aria-hidden="true" />
              {INSPECTOR_LABELS[mode]}
              {mode === "changed" && props.changedCount > 0 ? <Badge variant="outline">{props.changedCount}</Badge> : null}
              {mode === "approvals" && props.approvalCount > 0 ? <Badge variant="outline">{props.approvalCount}</Badge> : null}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={props.inspectorOpen ? "Close inspector" : "Open inspector"}
          onClick={props.onToggleInspector}
        >
          {props.inspectorOpen ? (
            <PanelRightClose data-icon="inline-start" aria-hidden="true" />
          ) : (
            <PanelRightOpen data-icon="inline-start" aria-hidden="true" />
          )}
        </Button>
      </div>
      {props.gatewayTargetSelector}
    </header>
  );
}
