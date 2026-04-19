import { useSessionStore } from "../lib/session-store.js";
import { PROVIDER_METADATA } from "../lib/provider-metadata.js";

interface ProviderStatusProps {
  readonly onOpenPicker: () => void;
}

function resolveProviderLabel(providerId: string | null, fallbackLabel?: string): string {
  if (!providerId) return "—";
  return PROVIDER_METADATA[providerId]?.label ?? fallbackLabel ?? providerId;
}

function modeLabel(mode: "user" | "auto" | "responding"): string {
  if (mode === "user") return "via user";
  if (mode === "responding") return "responding";
  return "auto";
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

  return (
    <button
      type="button"
      aria-label="Current provider. Click to change."
      onClick={props.onOpenPicker}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
        routeMode === "responding"
          ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-text)]"
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
      ].join(" ")}
    >
      <span>{displayLabel}</span>
      <span aria-hidden="true">·</span>
      <span>{displayModel && displayModel.trim().length > 0 ? displayModel : "—"}</span>
      <span aria-hidden="true">·</span>
      <span>{routeText}</span>
      <span aria-hidden="true">·</span>
      <span>
        authority: {authorityStatus?.effective ?? "unknown"} · {authorityStatus?.completeness ?? "partial"}
      </span>
      {providerSwitching ? (
        <span className="text-[var(--color-warning)]">switching…</span>
      ) : null}
    </button>
  );
}
