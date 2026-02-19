import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const PHASES = ["Analyze", "Research", "Architect", "Implement", "Verify", "Synthesize"] as const;

interface PhaseProgressProps {
  phase: string;
}

export function PhaseProgress({ phase }: PhaseProgressProps) {
  const currentIndex = PHASES.findIndex((p) => p.toLowerCase() === phase.toLowerCase());

  return (
    <div className="flex items-center gap-0">
      {PHASES.map((p, i) => {
        const isDone = currentIndex >= 0 && i < currentIndex;
        const isActive = i === currentIndex;

        return (
          <div key={p} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              {/* Circle */}
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all",
                  isDone && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
                  isActive && "bg-chart-1/20 text-chart-1 border border-chart-1/40 ring-2 ring-chart-1/20",
                  !isDone && !isActive && "bg-secondary text-muted-foreground border border-border",
                )}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              {/* Label */}
              <span
                className={cn(
                  "text-xs transition-colors",
                  isDone && "text-emerald-400",
                  isActive && "text-foreground font-semibold",
                  !isDone && !isActive && "text-muted-foreground",
                )}
              >
                {p}
              </span>
            </div>
            {/* Connector line */}
            {i < PHASES.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 mx-2 mb-5 transition-colors",
                  isDone ? "bg-emerald-500/40" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
