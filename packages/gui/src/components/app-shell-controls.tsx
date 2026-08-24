import type {
  GuiAppDescriptor,
  GuiAuthorityStatus,
  GuiDeliberationLevelId,
  OperatorTurnRequestedAuthority,
  OperatorWorkspaceGatewayTargetSummary,
} from "@kilnai/gateway-contracts";
import { CircleAlert, Hand, LockKeyhole, RotateCcw, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authorityStatusTitle } from "../lib/authority-status-view.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type RequestableTurnAuthority = OperatorTurnRequestedAuthority;

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

const TURN_AUTHORITY_SELECT_ITEMS = TURN_AUTHORITY_OPTIONS.map((value) => ({
  label: TURN_AUTHORITY_OPTIONS_VIEW[value].label,
  value,
}));

type RuntimeBootstrapGateProps =
  | {
      readonly state: "loading";
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly state: "error";
      readonly title: string;
      readonly detail: string;
      readonly onRetry: () => void;
    };

export function RuntimeBootstrapGate(props: RuntimeBootstrapGateProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      {props.state === "error" ? (
        <Alert aria-label="Runtime bootstrap" className="max-w-md" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle><h1>{props.title}</h1></AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-4 break-words">
            <p>{props.detail}</p>
            <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Retry connection
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <section
          role="status"
          aria-busy="true"
          aria-label="Runtime bootstrap"
          aria-live="polite"
          className="flex w-full max-w-sm items-start gap-3"
        >
          <Spinner aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-foreground">{props.title}</h1>
            <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{props.detail}</p>
          </div>
        </section>
      )}
    </main>
  );
}

export function DeliberationControl(props: {
  readonly value: GuiDeliberationLevelId | null;
  readonly options: readonly GuiDeliberationLevelId[];
  readonly onChange: (value: GuiDeliberationLevelId | null) => void;
}) {
  if (props.options.length === 0) return null;
  const providerDefaultValue = "__kiln_provider_default__";
  const items = [
    { label: "Provider default", value: providerDefaultValue },
    ...props.options.map((value) => ({ label: value, value })),
  ];
  return (
    <Select
      items={items}
      value={props.value ?? providerDefaultValue}
      onValueChange={(value) => {
        if (value) {
          props.onChange(value === providerDefaultValue ? null : value);
        }
      }}
    >
      <SelectTrigger variant="ghost" size="sm" aria-label="Deliberation level" className="h-8 w-auto min-w-24">
        <span className="truncate">{props.value ?? "Provider default"}</span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value={providerDefaultValue}>Provider default</SelectItem>
          {props.options.map((level) => (
            <SelectItem key={level} value={level}>
              {level}
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
      items={TURN_AUTHORITY_SELECT_ITEMS}
      value={props.value}
      onValueChange={(value) => {
        if (TURN_AUTHORITY_OPTIONS.includes(value as RequestableTurnAuthority)) {
          props.onChange(value as RequestableTurnAuthority);
        }
      }}
    >
      <SelectTrigger
        variant="ghost"
        size="sm"
        aria-label={`Turn authority: ${selectedAuthority.label}`}
        aria-description={title}
        title={title}
        className="h-8 w-auto min-w-28"
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
