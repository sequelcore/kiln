import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, Palette, Settings2, Wrench, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./settings-navigation.js";

const SETTINGS_SECTIONS = [
  {
    id: "available-models",
    label: "Available models",
    description: "Discovery and route readiness",
    icon: Boxes,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and interface presentation",
    icon: Palette,
  },
  {
    id: "configuration",
    label: "Configuration",
    description: "Config health, projections, and repair",
    icon: Wrench,
  },
] as const satisfies readonly {
  readonly id: SettingsSection;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof Palette;
}[];

function sectionDefinition(section: SettingsSection) {
  return SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];
}

export function SettingsWorkspace(props: {
  readonly section: SettingsSection;
  readonly sidebarWidth?: number;
  readonly appearance: ReactNode;
  readonly configuration: ReactNode;
  readonly availableModels: ReactNode;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly onBack: () => void;
}) {
  const activeSection = sectionDefinition(props.section);
  const content = props.section === "appearance" ? props.appearance : props.section === "configuration" ? props.configuration : props.availableModels;
  const sidebarStyle: CSSProperties | undefined = props.sidebarWidth
    ? { width: props.sidebarWidth, minWidth: props.sidebarWidth, maxWidth: props.sidebarWidth }
    : undefined;

  return (
    <section aria-label="Settings" className="flex min-h-0 min-w-0 flex-1 bg-background text-foreground">
      <aside
        aria-label="Settings sidebar"
        className="hidden h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
        style={sidebarStyle}
      >
        <header className="flex min-h-12 items-center gap-2 border-b border-sidebar-border/70 px-3">
          <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">Settings</h1>
        </header>
        <nav aria-label="Settings sections" className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            const active = item.id === props.section;
            return (
              <Button
                key={item.id}
                type="button"
                variant={active ? "secondary" : "ghost"}
                size="sm"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => props.onSelectSection(item.id)}
                className={cn("h-auto min-h-10 w-full justify-start px-2 py-2 text-left", !active && "text-muted-foreground")}
              >
                <Icon className="self-start" data-icon="inline-start" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{item.description}</span>
                </span>
              </Button>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border/70 p-2">
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={props.onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back to workbench
          </Button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-workspace-viewer-panel px-3 lg:px-4">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to workbench" onClick={props.onBack} className="lg:hidden">
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">Settings</p>
            <p className="truncate text-sm font-semibold text-foreground">{activeSection.label}</p>
          </div>
          <Select
            value={props.section}
            onValueChange={(value) => {
              if (value === "appearance" || value === "configuration" || value === "available-models") props.onSelectSection(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="Settings section" className="w-40 lg:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SETTINGS_SECTIONS.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>
        <div className="min-h-0 flex-1">{content}</div>
      </main>
    </section>
  );
}
