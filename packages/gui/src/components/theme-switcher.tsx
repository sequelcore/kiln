import { Palette } from "lucide-react";
import { OPERATOR_THEME_LABELS, OPERATOR_THEME_NAMES } from "@kilnai/gateway-contracts";
import { useUiStore, type KilnTheme } from "../lib/ui-store.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ThemeSwitcherProps {
  readonly onThemeSelected?: (theme: KilnTheme) => void;
}

const FALLBACK_THEME_NAMES = ["kiln-dark", "kiln-graphite", "kiln-light", "system-follow"] as const;
const THEME_NAMES = Array.isArray(OPERATOR_THEME_NAMES) && OPERATOR_THEME_NAMES.length > 0
  ? OPERATOR_THEME_NAMES
  : FALLBACK_THEME_NAMES;

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  function applyThemeSelection(nextTheme: KilnTheme): void {
    setTheme(nextTheme);
    props.onThemeSelected?.(nextTheme);
  }

  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        if (value) {
          applyThemeSelection(value);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Theme" className="max-w-40">
        <Palette aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {THEME_NAMES.map((name) => (
            <SelectItem key={name} value={name}>
              {OPERATOR_THEME_LABELS[name] ?? name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
