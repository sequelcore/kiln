import type { BackendConfig } from "../../wrapper/session-registry.js";

export const PERMISSION_PROJECTION_TARGET_IDS = {
  claude: "claude-settings",
  codex: "codex-config",
  opencode: "opencode-config",
} as const;

export interface PermissionProjectionInput {
  readonly policy: unknown;
  readonly existingDocument: Record<string, unknown>;
}

export interface PermissionProjection {
  readonly targetId: string;
  readonly document: Record<string, unknown>;
  readonly managedFields: readonly string[];
}

export interface PermissionSyncMetadata {
  readonly backend: string;
  readonly representableRules: readonly unknown[];
  readonly unsupportedRules: readonly unknown[];
  readonly constraintInstructions: readonly string[];
  readonly warnings: readonly string[];
  readonly nativeRules: unknown;
}

export function toPermissionSyncMetadata(translated: BackendConfig): PermissionSyncMetadata {
  return {
    backend: translated.backend,
    representableRules: translated.representableRules.map((rule) => ({ ...rule })),
    unsupportedRules: translated.unsupportedRules.map((rule) => ({ ...rule })),
    constraintInstructions: [...translated.constraintInstructions],
    warnings: [...translated.warnings],
    nativeRules: translated.nativeRules,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
