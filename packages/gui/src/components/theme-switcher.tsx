import { Moon, Sun, Monitor, Check } from "lucide-react";
import { useUiStore, type KilnTheme } from "../lib/ui-store.js";

interface ThemeOption {
  value: KilnTheme;
  label: string;
  icon: React.ReactNode;
}

const OPTIONS: ThemeOption[] = [
  { value: "kiln-dark",     label: "Dark",   icon: <Moon    aria-hidden="true" size={14} /> },
  { value: "kiln-light",    label: "Light",  icon: <Sun     aria-hidden="true" size={14} /> },
  { value: "system-follow", label: "System", icon: <Monitor aria-hidden="true" size={14} /> },
];

export function ThemeSwitcher() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % OPTIONS.length;
      setTheme(OPTIONS[nextIndex]!.value);
      const el = e.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined;
      el?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
      setTheme(OPTIONS[prevIndex]!.value);
      const el = e.currentTarget.parentElement?.children[prevIndex] as HTMLElement | undefined;
      el?.focus();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setTheme(OPTIONS[index]!.value);
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
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={[
              "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
              selected
                ? "bg-[var(--color-background-element)] text-[var(--color-text)] border border-[var(--color-border-active)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent",
            ].join(" ")}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {selected && <Check aria-hidden="true" size={10} className="ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}
