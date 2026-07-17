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
  operator: ["var(--color-primary)", "var(--color-accent)", "var(--color-info)", "var(--color-success)"],
  assistant: ["var(--color-accent)", "var(--color-primary)", "var(--color-success)", "var(--color-info)"],
  agent: ["var(--color-success)", "var(--color-primary)", "var(--color-accent)", "var(--color-info)"],
  agent_profile: ["var(--color-info)", "var(--color-success)", "var(--color-primary)", "var(--color-accent)"],
  provider: ["var(--color-primary)", "var(--color-info)", "var(--color-accent)", "var(--color-success)"],
  tool: ["var(--color-accent)", "var(--color-warning)", "var(--color-primary)", "var(--color-text-muted)"],
  system: ["var(--color-error)", "var(--color-warning)", "var(--color-text-muted)", "var(--color-accent)"],
};

const stateColors: Record<Exclude<OperatorAvatarState, "idle">, readonly string[]> = {
  running: ["var(--color-info)", "var(--color-primary)"],
  success: ["var(--color-success)", "var(--status-success-border)"],
  warning: ["var(--color-warning)", "var(--status-warning-border)"],
  error: ["var(--color-error)", "var(--status-danger-border)"],
};

const stateIntensity: Record<OperatorAvatarState, "none" | "subtle" | "medium" | "dramatic"> = {
  idle: "subtle",
  running: "medium",
  success: "subtle",
  warning: "medium",
  error: "none",
};

function statusMouth(state: OperatorAvatarState) {
  if (state === "idle") return undefined;
  return () => (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full",
        state === "running" ? "h-1.5 w-3 animate-pulse bg-text-inverse/90" : "",
        state === "success" ? "h-1.5 w-3 bg-text-inverse/90" : "",
        state === "warning" ? "h-2 w-2 bg-text-inverse/90" : "",
        state === "error" ? "h-1.5 w-1.5 bg-text-inverse/90 shadow-[5px_0_0_color-mix(in_oklch,var(--color-text-inverse)_90%,transparent)]" : "",
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
  const showInitial = state === "idle";
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
        intensity3d={stateIntensity[state]}
        interactive={animated}
        showInitial={showInitial}
        colors={[...colors]}
        className="font-semibold text-text-inverse/95"
        gradientOverlayClass="bg-[radial-gradient(ellipse_at_35%_22%,color-mix(in_oklch,var(--color-text-inverse)_38%,transparent),color-mix(in_oklch,var(--color-text-inverse)_12%,transparent)_38%,transparent_72%)]"
        enableBlink={animated}
        onRenderMouth={statusMouth(state)}
      />
    </span>
  );
}
