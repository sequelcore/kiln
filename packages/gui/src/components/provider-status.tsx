import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import { ChevronDownIcon } from "lucide-react";
import { useSessionStore } from "../lib/session-store.js";
import { Button } from "@/components/ui/button";
import { formatAuthorityStatus } from "../lib/authority-status-view.js";

interface ProviderStatusProps {
  readonly onOpenPicker: () => void;
  readonly domainLabel?: string;
  readonly workingDirectory?: string;
  readonly compact?: boolean;
}

function resolveProviderLabel(providerId: string | null, fallbackLabel?: string): string {
  if (!providerId) return "Select provider";
  return getGuiProviderMetadata(providerId)?.label ?? fallbackLabel ?? providerId;
}

function modeLabel(mode: "user" | "auto" | "responding"): string {
  if (mode === "user") return "via user";
  if (mode === "responding") return "responding";
  return "auto";
}

function formatWorkingDirectory(workingDirectory: string | undefined): string {
  if (!workingDirectory) {
    return "—";
  }
  const normalized = workingDirectory.replace(/\\/g, "/");
  if (normalized.length <= 32) {
    return normalized;
  }
  const segments = normalized.split("/").filter(Boolean);
  const tail = segments.slice(-2).join("/");
  return tail ? `.../${tail}` : normalized;
}

export function ProviderStatus(props: ProviderStatusProps) {
  const providers = useSessionStore((state) => state.providers);
  const activeProvider = useSessionStore((state) => state.activeProvider);
  const activeModel = useSessionStore((state) => state.activeModel);
  const routeMode = useSessionStore((state) => state.routeMode);
  const respondingProvider = useSessionStore((state) => state.respondingProvider);
  const respondingModel = useSessionStore((state) => state.respondingModel);
  const providerSwitching = useSessionStore((state) => state.providerSwitching);
  const authorityStatus = useSessionStore((state) => state.authorityStatus);

  const providerById = new Map(providers.map((provider) => [provider.id, provider] as const));
  const displayProviderId = routeMode === "responding"
    ? (respondingProvider ?? activeProvider)
    : activeProvider;
  const displayModel = routeMode === "responding"
    ? (respondingModel ?? activeModel)
    : activeModel;
  const displayLabel = resolveProviderLabel(displayProviderId, providerById.get(displayProviderId ?? "")?.label);
  const routeText = modeLabel(routeMode);
  const modelLabel = displayModel && displayModel.trim().length > 0 ? displayModel : "Select model";
  const compactLabel = displayProviderId
    ? `${displayLabel} / ${modelLabel}`
    : "Select provider / model";
  const authorityStatusLabel = formatAuthorityStatus(authorityStatus);

  if (props.compact) {
    return (
      <Button
        type="button"
        variant={routeMode === "responding" ? "secondary" : "ghost"}
        size="sm"
        aria-label={`Provider selector. Current selection: ${compactLabel}. ${authorityStatusLabel}. Click to change.`}
        aria-live="polite"
        onClick={props.onOpenPicker}
        className="h-8 min-w-0 max-w-full shrink justify-start px-2 text-left"
      >
        <span className="min-w-0 truncate">{providerSwitching ? "Switching provider..." : compactLabel}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={routeMode === "responding" ? "secondary" : "outline"}
      aria-label={`Provider selector. Current selection: ${compactLabel}. ${authorityStatusLabel}. Click to change.`}
      onClick={props.onOpenPicker}
      title={[
        `domain: ${props.domainLabel ?? "—"}`,
        `cwd: ${props.workingDirectory ?? "—"}`,
      ].join("\n")}
      className="h-auto min-w-0 shrink justify-start text-left"
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{displayLabel}</span>
          <span className="text-muted-foreground/45" aria-hidden="true">·</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {modelLabel}
          </span>
          <span className="text-muted-foreground/45" aria-hidden="true">·</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{routeText}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground/75">
          <span>domain: {props.domainLabel ?? "—"}</span>
          <span>cwd: {formatWorkingDirectory(props.workingDirectory)}</span>
          <span>{authorityStatusLabel}</span>
        </span>
      </span>
      {providerSwitching ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">switching…</span>
      ) : null}
    </Button>
  );
}
