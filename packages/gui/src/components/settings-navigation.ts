import {
  Bot,
  Boxes,
  ChartNoAxesColumn,
  Code2,
  HeartPulse,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  SwatchBook,
  Wrench,
} from "lucide-react";

export const SETTINGS_SECTIONS = [
  {
    id: "general",
    path: "/settings/general",
    label: "General",
    description: "Updates and workspace behavior",
    aliases: ["workspace", "preferences", "updates"],
    icon: SlidersHorizontal,
  },
  {
    id: "appearance",
    path: "/settings/appearance",
    label: "Appearance",
    description: "Color scheme and operator themes",
    aliases: ["theme", "interface", "light", "dark", "system"],
    icon: SwatchBook,
  },
  {
    id: "providers",
    path: "/settings/providers",
    label: "Providers",
    description: "Provider accounts and credentials",
    aliases: ["api keys", "authentication", "oauth"],
    icon: RadioTower,
  },
  {
    id: "models",
    path: "/settings/models",
    label: "Models",
    description: "Model catalog, defaults, and routing",
    aliases: ["model catalog", "execution routes", "inference"],
    icon: Boxes,
  },
  {
    id: "permissions",
    path: "/settings/permissions",
    label: "Permissions",
    description: "Approvals, sandboxing, and authority",
    aliases: ["access", "security", "governance"],
    icon: ShieldCheck,
  },
  {
    id: "tools",
    path: "/settings/tools",
    label: "Tools",
    description: "MCP servers, skills, and plugins",
    aliases: ["connectors", "integrations", "extensions"],
    icon: Wrench,
  },
  {
    id: "usage-and-limits",
    path: "/settings/usage-and-limits",
    label: "Usage & limits",
    description: "Token usage, budgets, and rate limits",
    aliases: ["costs", "quotas", "billing"],
    icon: ChartNoAxesColumn,
  },
  {
    id: "agents",
    path: "/settings/agents",
    label: "Agents",
    description: "Managed agents and delegation",
    aliases: ["workers", "orchestration", "subagents"],
    icon: Bot,
  },
  {
    id: "health",
    path: "/settings/health",
    label: "Health",
    description: "Runtime status and diagnostics",
    aliases: ["gateway", "readiness", "troubleshooting"],
    icon: HeartPulse,
  },
  {
    id: "advanced",
    path: "/settings/advanced",
    label: "Advanced",
    description: "Developer controls and diagnostics",
    aliases: ["experimental", "logs", "developer"],
    icon: Code2,
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsPath = (typeof SETTINGS_SECTIONS)[number]["path"];
export type SettingsSectionDefinition = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_PATHS: Readonly<Record<SettingsSection, SettingsPath>> = Object.freeze(
  Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section.path])) as Record<
    SettingsSection,
    SettingsPath
  >,
);

export function resolveSettingsSection(pathname: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => section.path === pathname)?.id ?? null;
}

export function settingsSectionDefinition(section: SettingsSection): SettingsSectionDefinition {
  return SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ?? SETTINGS_SECTIONS[0];
}

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function searchSettingsSections(query: string): readonly SettingsSectionDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return SETTINGS_SECTIONS;

  return SETTINGS_SECTIONS.filter(
    (section) =>
      section.label.toLocaleLowerCase().includes(normalizedQuery) ||
      section.description.toLocaleLowerCase().includes(normalizedQuery) ||
      section.aliases.some((alias) => alias.toLocaleLowerCase().includes(normalizedQuery)),
  );
}
