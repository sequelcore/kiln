import type {
  GuiAppDescriptor,
  GuiAuthorityStatus,
  GuiProviderReasoningEffort,
  OperatorTurnRequestedAuthority,
  OperatorWorkspaceGatewayTargetSummary,
} from "@kilnai/gateway-contracts";
import { Hand, LockKeyhole, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorityStatusTitle } from "../lib/authority-status-view.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type RequestableTurnAuthority = OperatorTurnRequestedAuthority;

const REASONING_EFFORT_LABELS: Record<GuiProviderReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

export const TURN_AUTHORITY_OPTIONS: readonly RequestableTurnAuthority[] = [
  "auto",
  "read_only",
  "audited",
  "destructive",
];

const TURN_AUTHORITY_OPTIONS_VIEW: Record<RequestableTurnAuthority, {
  readonly label: string;
  readonly description: string;
  readonly icon: typeof ShieldQuestion;
}> = {
  auto: {
    label: "Ask every time",
    description: "Prompt before tools need more authority.",
    icon: Hand,
  },
  read_only: {
    label: "Read only",
    description: "Allow inspection without changing files.",
    icon: ShieldQuestion,
  },
  audited: {
    label: "Approve for me",
    description: "Proceed with audited low-risk actions.",
    icon: ShieldCheck,
  },
  destructive: {
    label: "Full access",
    description: "Allow unrestricted local execution.",
    icon: LockKeyhole,
  },
};

export function RuntimeBootstrapGate(props: {
  readonly title: string;
  readonly detail: string;
  readonly error?: string | null;
  readonly onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-background)] px-6">
      <section
        role="status"
        aria-label="Runtime bootstrap"
        aria-live="polite"
        className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-background-panel)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-start gap-4">
          <div className="mt-1 grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background">
            <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{props.title}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{props.error ?? props.detail}</p>
            {props.error && props.onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={props.onRetry}
              >
                Retry
              </Button>
            ) : (
              <div className="mt-4 h-2 w-full overflow-hidden rounded bg-[var(--color-background-element)]">
                <div className="h-full w-1/3 animate-pulse rounded bg-[var(--color-accent)]" />
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export function ReasoningEffortControl(props: {
  readonly value: GuiProviderReasoningEffort;
  readonly options: readonly GuiProviderReasoningEffort[];
  readonly onChange: (value: GuiProviderReasoningEffort) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) {
          props.onChange(value);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Reasoning effort" className="w-auto min-w-20">
        <span className="truncate">{REASONING_EFFORT_LABELS[props.value]}</span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {props.options.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {REASONING_EFFORT_LABELS[effort]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function TurnAuthorityControl(props: {
  readonly value: RequestableTurnAuthority;
  readonly authorityStatus: GuiAuthorityStatus | null;
  readonly onChange: (value: RequestableTurnAuthority) => void;
}) {
  const selectedAuthority = TURN_AUTHORITY_OPTIONS_VIEW[props.value];
  const title = authorityStatusTitle(props.authorityStatus);
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (TURN_AUTHORITY_OPTIONS.includes(value as RequestableTurnAuthority)) {
          props.onChange(value as RequestableTurnAuthority);
        }
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Turn authority: ${selectedAuthority.label}`}
        title={title}
        className="w-auto min-w-28"
      >
        <span className="truncate">{selectedAuthority.label}</span>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-80">
        <SelectGroup>
          {TURN_AUTHORITY_OPTIONS.map((authority) => {
            const option = TURN_AUTHORITY_OPTIONS_VIEW[authority];
            const Icon = option.icon;
            return (
              <SelectItem key={authority} value={authority} className="items-start py-2 pr-9 pl-2">
                <span className="flex min-w-0 items-start gap-2">
                  <Icon data-icon="inline-start" className="mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{option.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function AppGatewayTargetSelector(props: {
  readonly apps: readonly GuiAppDescriptor[];
  readonly targets: readonly OperatorWorkspaceGatewayTargetSummary[];
  readonly selectedGatewayTargetId: string | null;
  readonly onSelectGatewayTarget: (targetId: string) => void;
}) {
  if (props.apps.length === 0) {
    return null;
  }

  const targetOptions = props.targets.filter((target) => {
    const appId = target.gatewayTarget.appId;
    if (!appId) return false;
    return props.apps.some((app) => app.name === appId && app.runtimeCapable);
  });
  if (targetOptions.length === 0) {
    return null;
  }
  const selectedTarget = targetOptions.find((target) => (
    target.gatewayTarget.targetId === props.selectedGatewayTargetId
  )) ?? targetOptions[0] ?? null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        value={props.selectedGatewayTargetId ?? targetOptions[0]?.gatewayTarget.targetId ?? ""}
        onValueChange={(value) => {
          if (value) {
            props.onSelectGatewayTarget(value);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="Gateway target" className="min-w-36 max-w-60">
          <span className="truncate">{selectedTarget ? formatGatewayTargetLabel(selectedTarget) : "Gateway target"}</span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {targetOptions.map((target) => (
              <SelectItem key={target.gatewayTarget.targetId} value={target.gatewayTarget.targetId}>
                {formatGatewayTargetLabel(target)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function formatGatewayTargetLabel(target: OperatorWorkspaceGatewayTargetSummary): string {
  const gatewayTarget = target.gatewayTarget;
  if (gatewayTarget.tenantId) {
    return `${target.label} · ${gatewayTarget.tenantId}`;
  }
  if (gatewayTarget.appId) {
    return target.label;
  }
  return gatewayTarget.label ?? target.label;
}
