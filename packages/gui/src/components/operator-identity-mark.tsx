import { Check, CircleDot, TriangleAlert, X, type LucideIcon } from "lucide-react";
import {
  operatorIdentityInitials,
  type OperatorIdentityProjection,
} from "@kilnai/gateway-contracts";
import { cn } from "@/lib/utils";

export type OperatorStatus = "idle" | "running" | "success" | "warning" | "error";

interface OperatorIdentityMarkProps {
  readonly identity: OperatorIdentityProjection;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

interface OperatorStatusIndicatorProps {
  readonly state: OperatorStatus;
  readonly showLabel?: boolean;
  readonly className?: string;
}

const sizeClass = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
} as const;

const kindClass: Record<OperatorIdentityProjection["kind"], string> = {
  operator: "rounded-full",
  assistant: "rounded-md border-primary/40 bg-primary/10 text-primary",
  agent: "rounded-md border-info/40 bg-status-info-background",
  agent_profile: "rounded-md border-info/40 bg-status-info-background",
  provider: "rounded-md",
  tool: "rounded-sm",
  system: "rounded-sm",
};

const statusPresentation: Record<OperatorStatus, {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly className: string;
}> = {
  idle: { label: "Idle", icon: CircleDot, className: "text-muted-foreground" },
  running: { label: "Running", icon: CircleDot, className: "text-info" },
  success: { label: "Success", icon: Check, className: "text-success" },
  warning: { label: "Warning", icon: TriangleAlert, className: "text-warning" },
  error: { label: "Error", icon: X, className: "text-destructive" },
};

export function OperatorIdentityMark(props: OperatorIdentityMarkProps) {
  const size = props.size ?? "md";
  return (
    <span
      role="img"
      aria-label={`${props.identity.label} identity`}
      title={props.identity.subtitle ? `${props.identity.label} · ${props.identity.subtitle}` : props.identity.label}
      data-identity-kind={props.identity.kind}
      className={cn(
        "inline-grid shrink-0 select-none place-items-center border border-border/80 bg-secondary font-mono font-semibold leading-none text-secondary-foreground",
        sizeClass[size],
        kindClass[props.identity.kind],
        props.className,
      )}
    >
      {operatorIdentityInitials(props.identity.label)}
    </span>
  );
}

export function OperatorStatusIndicator(props: OperatorStatusIndicatorProps) {
  const presentation = statusPresentation[props.state];
  const Icon = presentation.icon;
  return (
    <span
      role="img"
      aria-label={`${presentation.label} status`}
      title={presentation.label}
      data-operator-status={props.state}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
        presentation.className,
        props.className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {props.showLabel ? <span>{presentation.label}</span> : null}
    </span>
  );
}
