import { Facehash } from "facehash";
import type { OperatorIdentityProjection } from "@kilnai/gateway-contracts";
import { cn } from "@/lib/utils";

export type OperatorAvatarState = "idle" | "running" | "success" | "warning" | "error";
export type OperatorAvatarMotion = "none" | "subtle";

interface OperatorAvatarProps {
  readonly identity: OperatorIdentityProjection;
  readonly size?: "sm" | "md";
  readonly state?: OperatorAvatarState;
  readonly motion?: OperatorAvatarMotion;
  readonly className?: string;
}

const sizeClass = {
  sm: "size-7",
  md: "size-9",
} as const;

const facehashSize = {
  sm: 28,
  md: 36,
} as const;

const kindColors: Record<OperatorIdentityProjection["kind"], readonly string[]> = {
  operator: ["#38bdf8", "#2563eb", "#14b8a6", "#f59e0b"],
  assistant: ["#8b5cf6", "#06b6d4", "#22c55e", "#f97316"],
  agent: ["#22c55e", "#06b6d4", "#f97316", "#e11d48", "#8b5cf6", "#eab308"],
  agent_profile: ["#10b981", "#0ea5e9", "#f59e0b", "#d946ef"],
  provider: ["#0ea5e9", "#6366f1", "#14b8a6", "#84cc16"],
  tool: ["#f97316", "#eab308", "#06b6d4", "#64748b"],
  system: ["#ef4444", "#f97316", "#64748b", "#a855f7"],
};

const stateColors: Record<Exclude<OperatorAvatarState, "idle">, readonly string[]> = {
  running: ["#06b6d4", "#2563eb", "#22c55e", "#f59e0b"],
  success: ["#22c55e", "#16a34a", "#06b6d4", "#84cc16"],
  warning: ["#f59e0b", "#f97316", "#eab308", "#06b6d4"],
  error: ["#ef4444", "#e11d48", "#f97316", "#64748b"],
};

function statusMouth(state: OperatorAvatarState) {
  if (state === "idle") return undefined;
  return () => (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full",
        state === "running" ? "h-1.5 w-3 animate-pulse bg-white/90" : "",
        state === "success" ? "h-1.5 w-3 bg-white/90" : "",
        state === "warning" ? "h-2 w-2 bg-white/90" : "",
        state === "error" ? "h-1.5 w-1.5 bg-white/90 shadow-[5px_0_0_rgba(255,255,255,0.9)]" : "",
      )}
    />
  );
}

export function OperatorAvatar(props: OperatorAvatarProps) {
  const size = props.size ?? "md";
  const state = props.state ?? "idle";
  const motion = props.motion ?? "none";
  const animated = size === "md" && motion === "subtle" && state !== "error";
  const colors = state === "idle" ? kindColors[props.identity.kind] : stateColors[state];
  return (
    <span
      aria-label={`${props.identity.label} avatar`}
      title={props.identity.subtitle ? `${props.identity.label} · ${props.identity.subtitle}` : props.identity.label}
      data-avatar-state={state}
      data-avatar-motion={motion}
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-border/60 bg-background shadow-sm",
        sizeClass[size],
        props.className,
      )}
    >
      <Facehash
        aria-hidden="true"
        name={props.identity.seed}
        size={facehashSize[size]}
        variant={state === "idle" ? "gradient" : "solid"}
        intensity3d={state === "running" ? "medium" : "subtle"}
        interactive={animated}
        showInitial={false}
        colors={[...colors]}
        enableBlink={animated}
        onRenderMouth={statusMouth(state)}
      />
    </span>
  );
}
