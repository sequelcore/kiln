import { Check, Palette } from "lucide-react";
import { OPERATOR_THEME_LABELS, OPERATOR_THEME_NAMES } from "@kilnai/gateway-contracts";
import { useUiStore, type KilnTheme } from "../lib/ui-store.js";

interface ThemeSwitcherProps {
  readonly onThemeSelected?: (theme: KilnTheme) => void;
}

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  function applyThemeSelection(nextTheme: KilnTheme): void {
    setTheme(nextTheme);
    props.onThemeSelected?.(nextTheme);
  }

  return (
    <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-background px-2 text-xs text-foreground">
      <Palette className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => applyThemeSelection(event.target.value as KilnTheme)}
        className="max-w-36 bg-transparent text-xs font-medium text-foreground outline-none"
      >
        {OPERATOR_THEME_NAMES.map((name) => (
          <option key={name} value={name}>
            {OPERATOR_THEME_LABELS[name]}
          </option>
        ))}
      </select>
      <Check className="size-3 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}
