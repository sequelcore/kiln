import type { ExternalHarnessTerminalEvidence, TurnTerminalDisposition } from "@kilnai/core/agents";

export type NativeHarnessId = ExternalHarnessTerminalEvidence["harness"];

export function nativeHarnessTerminalDisposition(input: {
  readonly harness: NativeHarnessId;
  readonly outcome: "completed" | "failed";
}): Extract<
  TurnTerminalDisposition,
  { readonly dispositionReason: "external_harness_completed" | "external_harness_failed" }
> {
  if (input.outcome === "completed") {
    return {
      outcome: "completed",
      dispositionReason: "external_harness_completed",
      externalHarness: { harness: input.harness },
    };
  }
  return {
    outcome: "failed",
    dispositionReason: "external_harness_failed",
    externalHarness: { harness: input.harness },
  };
}

export function nativeHarnessCancellationDisposition(
  reason: "operator_cancelled" | "runtime_cancelled",
): Extract<TurnTerminalDisposition, { readonly dispositionReason: "operator_cancelled" | "runtime_cancelled" }> {
  return {
    outcome: "cancelled",
    dispositionReason: reason,
  };
}
