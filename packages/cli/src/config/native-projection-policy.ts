import {
  HARNESSES_WITH_NATIVE_PROJECTION,
  supportsHarnessIntegration,
  type HarnessIntegrationId,
} from "./harness-integration-capabilities.js";

export const NATIVE_PROJECTION_HARNESSES = HARNESSES_WITH_NATIVE_PROJECTION;

export type NativeProjectionHarness = HarnessIntegrationId;

export interface NativeProjectionSyncOptions {
  readonly force?: boolean;
  readonly disabledHarnesses?: readonly NativeProjectionHarness[];
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
