import type { InvocationAdmission } from "@kilnai/core";
import {
  assertBoundHostToolSandbox,
  type BoundHostToolSandbox,
} from "@kilnai/core/sandbox";
import type { EffectiveAuthorityAdmissionBundle } from "./effective-authority-admission-bundle.js";

export interface RuntimeHostToolEnforcement {
  readonly admissionId: EffectiveAuthorityAdmissionBundle["admissionId"];
  readonly sandboxId: `sha256:${string}`;
}

interface RuntimeHostToolEnforcementBinding {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly sandbox: BoundHostToolSandbox;
  readonly invocationAdmission: InvocationAdmission;
}

interface RuntimeHostToolEnforcementExpectation {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly sandbox: unknown;
  readonly invocationAdmission: InvocationAdmission | undefined;
}

const runtimeHostBindings = new WeakMap<object, RuntimeHostToolEnforcementBinding>();

/** Binds persisted evidence to the exact process-local effect enforcers. */
export function createRuntimeHostToolEnforcement(input: RuntimeHostToolEnforcementBinding): RuntimeHostToolEnforcement {
  const sandbox = assertBoundHostToolSandbox(input.sandbox);
  const admitted = input.bundle.turn.tools.hostEnforcement;
  if (!admitted || JSON.stringify(admitted) !== JSON.stringify(sandbox.admission)) {
    throw new Error("Runtime host enforcement sandbox does not match the persisted authority admission.");
  }
  if (input.bundle.configuration.turnRevision.revisionSetId !== admitted.configurationRevisionId) {
    throw new Error("Runtime host enforcement configuration revision does not match the persisted turn.");
  }
  if (!input.invocationAdmission || typeof input.invocationAdmission.authorize !== "function") {
    throw new TypeError("Runtime host enforcement requires an invocation admission boundary.");
  }
  const context = Object.freeze({
    admissionId: input.bundle.admissionId,
    sandboxId: admitted.sandboxId,
  });
  runtimeHostBindings.set(context, { bundle: input.bundle, sandbox, invocationAdmission: input.invocationAdmission });
  return context;
}

/** Revalidates identity immediately before provider launch or a tool effect. */
export function assertRuntimeHostToolEnforcement(
  value: unknown,
  expected: RuntimeHostToolEnforcementExpectation,
): RuntimeHostToolEnforcement {
  if (value === null || typeof value !== "object") {
    throw new Error("A process-local Runtime host enforcement capability is required.");
  }
  const binding = runtimeHostBindings.get(value);
  if (!binding) throw new Error("A process-local Runtime host enforcement capability is required.");
  if (binding.bundle !== expected.bundle || binding.bundle.admissionId !== expected.bundle.admissionId) {
    throw new Error("Runtime host enforcement is stale or belongs to another authority admission.");
  }
  const sandbox = assertBoundHostToolSandbox(expected.sandbox);
  if (binding.sandbox !== sandbox) {
    throw new Error("Runtime host enforcement does not bind the exact tool sandbox.");
  }
  if (binding.invocationAdmission !== expected.invocationAdmission) {
    throw new Error("Runtime host enforcement does not bind the exact invocation admission.");
  }
  assertBoundHostToolSandbox(binding.sandbox);
  const admitted = binding.bundle.turn.tools.hostEnforcement;
  if (!admitted || admitted.sandboxId !== binding.sandbox.admission.sandboxId) {
    throw new Error("Runtime host enforcement evidence no longer matches its admitted sandbox.");
  }
  return value as RuntimeHostToolEnforcement;
}
