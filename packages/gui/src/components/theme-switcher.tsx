import { Moon, Sun, Monitor, Check, type LucideIcon } from "lucide-react";
import { useUiStore, type KilnTheme } from "../lib/ui-store.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeOption {
  value: KilnTheme;
  label: string;
  icon: LucideIcon;
}

interface ThemeSwitcherProps {
  readonly onThemeSelected?: (theme: KilnTheme) => void;
}

const OPTIONS: ThemeOption[] = [
  { value: "kiln-dark",     label: "Dark",   icon: Moon },
  { value: "kiln-light",    label: "Light",  icon: Sun },
  { value: "system-follow", label: "System", icon: Monitor },
];

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  function applyThemeSelection(nextTheme: KilnTheme): void {
    setTheme(nextTheme);
    props.onThemeSelected?.(nextTheme);
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % OPTIONS.length;
      applyThemeSelection(OPTIONS[nextIndex]!.value);
      const el = e.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined;
      el?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
      applyThemeSelection(OPTIONS[prevIndex]!.value);
      const el = e.currentTarget.parentElement?.children[prevIndex] as HTMLElement | undefined;
      el?.focus();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      applyThemeSelection(OPTIONS[index]!.value);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5"
    >
      {OPTIONS.map((opt, i) => {
        const selected = theme === opt.value;
        const Icon = opt.icon;
        return (
          <Button
            key={opt.value}
            type="button"
            role="radio"
            variant={selected ? "secondary" : "ghost"}
            size="xs"
            aria-checked={selected}
            aria-label={opt.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => applyThemeSelection(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(selected ? "border border-ring/60" : "text-muted-foreground")}
          >
            <Icon data-icon="inline-start" aria-hidden="true" />
            <span>{opt.label}</span>
            {selected ? <Check data-icon="inline-end" aria-hidden="true" /> : null}
          </Button>
        );
      })}
    </div>
  );
}
