export type NativeProjectionHarness = "claude" | "codex" | "opencode";

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
