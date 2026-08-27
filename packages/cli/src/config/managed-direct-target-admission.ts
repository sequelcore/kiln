import {
  admitOperatorExecutionIntent,
  type AdmittedExecutionTarget,
  type DirectExecutionTarget,
  type ExecutionTargetCatalog,
} from "@kilnai/core";
import type { ResolvedManagedTargetConfig } from "./resolved-managed-target.js";

export interface ManagedDirectTargetAdmission {
  readonly target: Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }>;
  readonly executionTarget: DirectExecutionTarget;
  readonly admission: AdmittedExecutionTarget;
}

export function admitManagedDirectTarget(
  catalog: ExecutionTargetCatalog | undefined,
  target: Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }>,
): ManagedDirectTargetAdmission {
  if (!catalog) throw new Error(`Managed direct target '${target.id}' requires the global target catalog.`);
  const executionTarget = catalog.targets.find(({ id }) => id === target.id);
  if (!executionTarget) throw new Error(`Managed direct target '${target.id}' is unavailable.`);
  return {
    target,
    executionTarget,
    admission: admitOperatorExecutionIntent(catalog, { targetId: target.id }),
  };
}
