import type { GuiAuthorityStatus } from "@kilnai/gateway-contracts";

const AUTHORITY_LABELS: Readonly<Record<string, string>> = {
  auto: "Auto",
  planning: "Planning",
  read_only: "Read only",
  idempotent: "Idempotent",
  audited: "Audited",
  destructive: "Destructive",
  fail_closed: "Blocked",
  unknown: "Unknown",
};

const COMPLETENESS_LABELS: Readonly<Record<string, string>> = {
  authoritative: "Authoritative",
  partial: "Partial",
};

export function authorityLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return AUTHORITY_LABELS[value] ?? "Unavailable";
}

function sandboxLabel(value: string | null | undefined): string | null {
  if (!value || value === "none") return null;
  if (value === "read_only") return "Read-only sandbox";
  if (value === "workspace_write" || value === "workspace-write") return "Workspace sandbox";
  if (value === "unknown") return "Sandbox unknown";
  return "Sandbox unavailable";
}

function completenessLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return COMPLETENESS_LABELS[value] ?? "Unknown";
}

export function formatAuthorityStatus(status: GuiAuthorityStatus | null): string {
  if (!status) return "Authority: Unknown";
  const requested = authorityLabel(status.requestedAuthority);
  const admitted = authorityLabel(status.admittedAuthority ?? status.effective);
  const sandbox = sandboxLabel(status.sandboxProjection);
  return `Authority: ${requested} -> ${admitted}${sandbox ? ` · ${sandbox}` : ""} · ${completenessLabel(status.completeness)}`;
}

export function authorityStatusTitle(status: GuiAuthorityStatus | null): string {
  if (!status) return "Authority is not available.";
  return [
    `Requested: ${authorityLabel(status.requestedAuthority)}`,
    `Granted: ${authorityLabel(status.admittedAuthority ?? status.effective)}`,
    sandboxLabel(status.sandboxProjection),
    `Completeness: ${completenessLabel(status.completeness)}`,
    status.reason,
  ].filter(Boolean).join("\n");
}
