import { ArrowLeft, Search, Settings2 } from "lucide-react";
import type { KilnSettingsEntry } from "@kilnai/gateway-contracts";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  isSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionDefinition,
  searchSettingsSections,
  settingsSectionDefinition,
} from "./settings-navigation.js";

const DESKTOP_LAYOUT_QUERY = "(min-width: 1024px)";

export interface SettingsSearchSelection {
  readonly section: SettingsSection;
  readonly targetId?: string;
}

interface SettingsSearchResult {
  readonly id: string;
  readonly section: SettingsSection;
  readonly targetId?: string;
  readonly label: string;
  readonly description: string;
  readonly icon: SettingsSectionDefinition["icon"];
}

function useDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_LAYOUT_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const update = () => setIsDesktop(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

function isShortcutExcluded(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest('[role="dialog"], [aria-modal="true"]')) return true;
  return (
    element.isContentEditable ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function SettingsSearch(props: {
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectResult: (result: SettingsSearchResult) => void;
  readonly query: string;
  readonly results: readonly SettingsSearchResult[];
}) {
  const listboxId = useId();
  const hasQuery = props.query.trim().length > 0;
  const activeResult = props.results[props.activeIndex];

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || props.results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      props.onActiveIndexChange((props.activeIndex + 1) % props.results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      props.onActiveIndexChange((props.activeIndex - 1 + props.results.length) % props.results.length);
      return;
    }
    if (event.key === "Enter" && activeResult) {
      event.preventDefault();
      props.onSelectResult(activeResult);
    }
  }

  return (
    <div role="search" className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={props.inputRef}
        type="search"
        role="combobox"
        aria-label="Search settings"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={hasQuery}
        aria-activedescendant={hasQuery && activeResult ? `${listboxId}-${activeResult.id}` : undefined}
        autoComplete="off"
        placeholder="Search settings"
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 bg-background/55 pl-8 pr-8 text-xs"
      />
      <kbd className="pointer-events-none absolute right-2 top-1.5 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
        /
      </kbd>

      {hasQuery ? (
        <div
          id={listboxId}
          className="absolute inset-x-0 top-9 z-40 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
        >
          {props.results.length > 0 ? (
            <div role="listbox" aria-label="Settings search results" className="max-h-72 overflow-y-auto p-1">
              {props.results.map((result, index) => {
                const Icon = result.icon;
                const active = index === props.activeIndex;
                return (
                  <button
                    id={`${listboxId}-${result.id}`}
                    key={result.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseEnter={() => props.onActiveIndexChange(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => props.onSelectResult(result)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none",
                      active ? "bg-accent text-accent-foreground" : "text-popover-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{result.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{result.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p role="status" className="px-3 py-4 text-center text-xs text-muted-foreground">
              No settings sections found
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsWorkspace(props: {
  readonly section: SettingsSection;
  readonly sidebarWidth?: number;
  readonly children: ReactNode;
  readonly entries?: readonly KilnSettingsEntry[];
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly onSearchResultSelect?: (selection: SettingsSearchSelection) => void;
  readonly onBack: () => void;
}) {
  const isDesktop = useDesktopLayout();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchResults = useMemo(() => {
    const sections: readonly SettingsSearchResult[] = searchSettingsSections(searchQuery).map((result) => ({
      id: `section:${result.id}`,
      section: result.id,
      label: result.label,
      description: result.description,
      icon: result.icon,
    }));
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return sections;
    const entries: readonly SettingsSearchResult[] = (props.entries ?? [])
      .filter((entry) => [entry.key, entry.label, entry.description, ...entry.searchTerms]
        .some((value) => value.toLowerCase().includes(normalizedQuery)))
      .map((entry) => {
        const owner = settingsSectionDefinition(entry.section);
        return {
          id: `entry:${entry.key}`,
          section: entry.section,
          targetId: `setting-${safeId(entry.key)}`,
          label: entry.label,
          description: `${owner.label} · ${entry.key}`,
          icon: owner.icon,
        };
      });
    return [...sections, ...entries];
  }, [props.entries, searchQuery]);
  const activeSection = settingsSectionDefinition(props.section);
  const sidebarStyle: CSSProperties | undefined = props.sidebarWidth
    ? { width: props.sidebarWidth, minWidth: props.sidebarWidth, maxWidth: props.sidebarWidth }
    : undefined;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isShortcutExcluded(document.activeElement)
      )
        return;

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, [isDesktop]);

  function updateSearchQuery(query: string) {
    setSearchQuery(query);
    setActiveResultIndex(0);
  }

  function selectSearchResult(result: SettingsSearchResult) {
    setSearchQuery("");
    setActiveResultIndex(0);
    props.onSelectSection(result.section);
    props.onSearchResultSelect?.({
      section: result.section,
      ...(result.targetId ? { targetId: result.targetId } : {}),
    });
  }

  const search = (
    <SettingsSearch
      inputRef={searchInputRef}
      query={searchQuery}
      results={searchResults}
      activeIndex={activeResultIndex}
      onQueryChange={updateSearchQuery}
      onActiveIndexChange={setActiveResultIndex}
      onSelectResult={selectSearchResult}
    />
  );

  return (
    <section aria-label="Settings" className="flex min-h-0 min-w-0 flex-1 bg-background text-foreground">
      <aside
        aria-label="Settings sidebar"
        className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
        style={sidebarStyle}
      >
        <header className="flex min-h-12 items-center gap-2 px-3">
          <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">Settings</h1>
        </header>
        <div className="border-y border-sidebar-border/70 p-2.5">{isDesktop ? search : null}</div>
        <nav aria-label="Settings sections" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
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
                className={cn(
                  "h-auto min-h-10 w-full items-start justify-start px-2 py-1.5 text-left",
                  !active && "text-muted-foreground",
                )}
              >
                <Icon className="mt-0.5" data-icon="inline-start" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{item.label}</span>
                  <span className="block truncate text-[11px] font-normal text-muted-foreground">
                    {item.description}
                  </span>
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
        <header className="shrink-0 border-b border-border/70 bg-workspace-viewer-panel px-3 py-2 lg:flex lg:min-h-14 lg:items-center lg:px-5 lg:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back to workbench"
              onClick={props.onBack}
              className="lg:hidden"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">Settings</p>
              <p className="truncate text-sm font-semibold text-foreground">{activeSection.label}</p>
            </div>
            <Select
              value={props.section}
              onValueChange={(value) => {
                if (value !== null && isSettingsSection(value)) props.onSelectSection(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Settings category" className="w-44 lg:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SETTINGS_SECTIONS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isDesktop ? <div className="mt-2">{search}</div> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-workspace-viewer">
          <div className="mx-auto min-h-full w-full max-w-5xl">{props.children}</div>
        </div>
      </main>
    </section>
  );
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/giu, "-");
}
