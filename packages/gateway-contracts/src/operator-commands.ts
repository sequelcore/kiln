export type OperatorCommandSurfaceKind = "cli" | "gui" | "tui";

export type OperatorCommandId =
  | "clear"
  | "theme"
  | "provider"
  | "effort"
  | "authority"
  | "resume"
  | "plan"
  | "exec"
  | "setup"
  | "goal";

export interface OperatorCommandDefinition {
  readonly id: OperatorCommandId;
  readonly trigger: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly surfaces: readonly OperatorCommandSurfaceKind[];
}

export const OPERATOR_COMMANDS: readonly OperatorCommandDefinition[] = [
  {
    id: "clear",
    trigger: "clear",
    title: "Clear session",
    description: "Reset the current conversation and start clean.",
    keywords: ["session", "reset", "new"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "theme",
    trigger: "theme",
    title: "Theme",
    description: "Open theme controls.",
    keywords: ["appearance", "dark", "light"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "provider",
    trigger: "provider",
    title: "Provider",
    description: "Open provider and model controls.",
    keywords: ["model", "routing", "provider"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "effort",
    trigger: "effort",
    title: "Reasoning effort",
    description: "Cycle or open reasoning effort controls.",
    keywords: ["reasoning", "effort", "model"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "authority",
    trigger: "authority",
    title: "Turn authority",
    description: "Cycle or open turn authority controls.",
    keywords: ["authority", "permission", "safety"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "resume",
    trigger: "resume",
    title: "Resume session",
    description: "Browse and resume previous sessions.",
    keywords: ["history", "session", "continue"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "plan",
    trigger: "plan",
    title: "Plan mode",
    description: "Switch the next turns into planning mode.",
    keywords: ["plan", "readonly", "design"],
    surfaces: ["gui", "tui", "cli"],
  },
  {
    id: "exec",
    trigger: "exec",
    title: "Execution mode",
    description: "Leave planning mode and execute the approved plan.",
    keywords: ["execute", "run", "implementation"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "setup",
    trigger: "setup",
    title: "Setup status",
    description: "Open config and projection status.",
    keywords: ["config", "status", "shims", "projection"],
    surfaces: ["gui", "tui"],
  },
  {
    id: "goal",
    trigger: "goal",
    title: "Goals",
    description: "Open governed goal and work-item controls.",
    keywords: ["goal", "work", "governance", "workflow"],
    surfaces: ["gui", "tui", "cli"],
  },
] as const;

export function listOperatorCommands(surface?: OperatorCommandSurfaceKind): readonly OperatorCommandDefinition[] {
  if (!surface) {
    return OPERATOR_COMMANDS;
  }
  return OPERATOR_COMMANDS.filter((command) => command.surfaces.includes(surface));
}

export function findOperatorCommand(
  idOrTrigger: string,
  surface?: OperatorCommandSurfaceKind,
): OperatorCommandDefinition | undefined {
  const normalized = idOrTrigger.trim().replace(/^\/+/, "").toLowerCase();
  return listOperatorCommands(surface).find(
    (command) => command.id === normalized || command.trigger.toLowerCase() === normalized,
  );
}
