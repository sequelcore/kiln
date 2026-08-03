import {
  HARNESSES_WITH_NATIVE_PROJECTION,
  supportsHarnessIntegration,
  type HarnessIntegrationId,
} from "./harness-integration-capabilities.js";

export const NATIVE_PROJECTION_HARNESSES = HARNESSES_WITH_NATIVE_PROJECTION;

export type NativeProjectionHarness = HarnessIntegrationId;

export interface NativeProjectionSyncOptions {
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly disabledHarnesses?: readonly NativeProjectionHarness[];
  /**
   * Explicit isolation root for tests/sandboxes. When set, every harness
   * target resolves under this one directory instead of consulting the
   * harness's own env var override or the OS home directory. See
   * `native-harness-home.ts` for full precedence.
   */
  readonly userHome?: string;
}

export interface ProjectionOutcome {
  readonly targetId: string;
  readonly path: string;
  readonly status: "planned" | "written" | "unchanged" | "removed" | "blocked" | "failed" | "skipped";
  readonly reason?: string;
}

export function describeProjectionDrift(fields: readonly string[]): string {
  return fields.map((field) => field === "$file" ? "file content" : field).join(", ");
}

export function isNativeProjectionHarnessDisabled(
  options: NativeProjectionSyncOptions,
  harness: NativeProjectionHarness,
): boolean {
  return options.disabledHarnesses?.includes(harness) ?? false;
}

export function supportsNativeProjection(harness: NativeProjectionHarness): boolean {
  return supportsHarnessIntegration(harness, "nativeProjection");
}
