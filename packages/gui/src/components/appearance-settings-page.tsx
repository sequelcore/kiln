import type { KilnSettingsSnapshot } from "@kilnai/gateway-contracts";
import {
  type AppearanceMode,
  type ColorScheme,
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  isOperatorAppearancePreference,
  OPERATOR_THEME_DEFINITIONS,
  type OperatorAppearancePreference,
  type OperatorThemeDefinition,
  operatorColorToCss,
} from "@kilnai/operator-appearance";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

interface AppearanceSettingsPageProps {
  readonly snapshot: KilnSettingsSnapshot | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onSave: (preference: OperatorAppearancePreference, expectedRevision: string) => Promise<void>;
  readonly onRefresh: () => Promise<unknown>;
}

const MODES: readonly { readonly id: AppearanceMode; readonly label: string; readonly icon: typeof Monitor }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

function snapshotPreference(snapshot: KilnSettingsSnapshot | null): OperatorAppearancePreference {
  const value = snapshot?.entries.find((entry) => entry.key === "ui.appearance")?.effective.value;
  return isOperatorAppearancePreference(value) ? value : DEFAULT_OPERATOR_APPEARANCE_PREFERENCE;
}

function ModePreview({ mode }: { readonly mode: AppearanceMode }) {
  const tesota = OPERATOR_THEME_DEFINITIONS.find((theme) => theme.id === "tesota");
  const light = tesota?.variants.light;
  const dark = tesota?.variants.dark;
  if (!light || !dark) return null;
  const palette = mode === "light" ? light : dark;
  const backgroundImage =
    mode === "system"
      ? `linear-gradient(105deg, ${operatorColorToCss(light.surface.canvas)} 0 48%, ${operatorColorToCss(dark.surface.canvas)} 48% 100%)`
      : undefined;
  return (
    <div
      className="relative h-28 overflow-hidden rounded-lg border p-2"
      style={{ backgroundColor: operatorColorToCss(palette.surface.canvas), backgroundImage }}
      aria-hidden="true"
    >
      <div className="grid h-full grid-cols-[2.25rem_1fr] gap-2">
        <div className="rounded border" style={{ backgroundColor: operatorColorToCss(light.sidebar.background) }} />
        <div className="space-y-2 pt-1">
          <div
            className="h-2 w-3/4 rounded-full"
            style={{ backgroundColor: operatorColorToCss(palette.surface.raised) }}
          />
          <div className="h-2 w-1/2 rounded-full" style={{ backgroundColor: operatorColorToCss(palette.text.muted) }} />
          <div
            className="absolute inset-x-12 bottom-3 h-5 rounded border"
            style={{
              backgroundColor: operatorColorToCss(palette.surface.default),
              borderColor: operatorColorToCss(palette.surface.border),
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ThemeCard(props: {
  readonly definition: OperatorThemeDefinition;
  readonly scheme: ColorScheme;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const palette = props.definition.variants[props.scheme];
  if (!palette) return null;
  const swatches = [palette.control.accent, palette.surface.raised, palette.status.info.color];
  return (
    <Button
      type="button"
      variant="outline"
      disabled={props.disabled}
      aria-pressed={props.selected}
      aria-label={`Use ${props.definition.label} for ${props.scheme} mode`}
      onClick={props.onSelect}
      className={cn(
        "h-auto min-h-28 w-full justify-between rounded-xl p-4 text-left",
        props.selected && "border-primary ring-1 ring-primary",
      )}
    >
      <span className="flex min-w-0 flex-col gap-5">
        <span className="flex -space-x-2" aria-hidden="true">
          {swatches.map((color, index) => (
            <span
              key={`${props.definition.id}-${index}`}
              className="size-11 rounded-full border-2 border-background shadow-sm"
              style={{ backgroundColor: operatorColorToCss(color) }}
            />
          ))}
        </span>
        <span>
          <span className="block text-sm font-semibold">{props.definition.label}</span>
          <span className="block text-xs text-muted-foreground">Built in · {props.scheme}</span>
        </span>
      </span>
      {props.selected ? <Check className="size-4 self-end text-primary" aria-hidden="true" /> : null}
    </Button>
  );
}

export function AppearanceSettingsPage(props: AppearanceSettingsPageProps) {
  const canonical = snapshotPreference(props.snapshot);
  const [draft, setDraft] = useState<OperatorAppearancePreference>(canonical);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const previewAppearance = useUiStore((state) => state.previewAppearance);
  const syncAppearancePreference = useUiStore((state) => state.syncAppearancePreference);
  const setAppearancePreference = useUiStore((state) => state.setAppearancePreference);

  useEffect(() => {
    setDraft(canonical);
  }, [canonical]);

  async function commit(next: OperatorAppearancePreference): Promise<void> {
    if (pending) return;
    setDraft(next);
    setFailure(null);
    previewAppearance(next);
    setPending(true);
    try {
      await props.onSave(next, props.snapshot?.revisions.global ?? "absent");
    } catch (error) {
      setDraft(canonical);
      syncAppearancePreference(canonical);
      setPending(false);
      setFailure(`Theme change failed. ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setAppearancePreference(next);
    try {
      await props.onRefresh();
    } catch (error) {
      setFailure(
        `Theme saved, but settings could not be refreshed. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setPending(false);
  }

  if (props.loading && !props.snapshot) {
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        Loading appearance…
      </p>
    );
  }
  if (props.error && !props.snapshot) {
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-destructive">
          Appearance could not be loaded: {props.error.message}
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => props.onRefresh()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-8 sm:px-8 lg:px-10">
      <header className="mb-8 max-w-2xl">
        <h2 id="settings-appearance-heading" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          Appearance
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose how Kiln looks. System follows this device while keeping an explicit theme for each color scheme.
        </p>
      </header>

      <fieldset disabled={pending} aria-busy={pending}>
        <legend className="mb-3 text-sm font-semibold">Color scheme</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const selected = draft.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={selected}
                onClick={() => void commit({ ...draft, mode: mode.id })}
                className={cn(
                  "rounded-xl border bg-card p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
                )}
              >
                <ModePreview mode={mode.id} />
                <span className="flex items-center justify-between px-1 pb-1 pt-3 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" aria-hidden="true" />
                    {mode.label}
                  </span>
                  {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {(["light", "dark"] as const).map((scheme) => (
        <section key={scheme} aria-labelledby={`${scheme}-themes-heading`} className="mt-9">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h3 id={`${scheme}-themes-heading`} className="text-sm font-semibold">
                {scheme === "light" ? "Light" : "Dark"} themes
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">Used when the effective color scheme is {scheme}.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {OPERATOR_THEME_DEFINITIONS.filter((theme) => theme.variants[scheme]).map((theme) => (
              <ThemeCard
                key={theme.id}
                definition={theme}
                scheme={scheme}
                selected={draft.themeByScheme[scheme] === theme.id}
                disabled={pending}
                onSelect={() =>
                  void commit({
                    ...draft,
                    themeByScheme: { ...draft.themeByScheme, [scheme]: theme.id },
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}

      {failure ? (
        <p role="status" className="mt-6 text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Saving appearance…
        </p>
      ) : null}
    </div>
  );
}
