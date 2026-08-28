/**
 * Evidence used to describe whether one turn produced new material.
 *
 * This is deliberately independent from completion or verification. A
 * progress value records only a material-result identity; it never asserts
 * that a task is complete.
 */
export type TurnProgressEvidence =
  | {
      readonly kind: "progress";
      readonly reason: "new_material_result";
      readonly evidenceFingerprint: string;
      readonly supportingToolCallIds: readonly string[];
    }
  | {
      readonly kind: "no_progress";
      readonly reason:
        | "repeated_result"
        | "failed_execution"
        | "invalid_input"
        | "empty_discovery"
        | "empty_result";
      readonly strategyFingerprint: string;
      readonly supportingToolCallIds: readonly string[];
    }
  | {
      readonly kind: "no_progress";
      readonly reason: "blocked_batch";
      readonly strategyFingerprint: string;
      readonly supportingToolCallIds: readonly string[];
    };
