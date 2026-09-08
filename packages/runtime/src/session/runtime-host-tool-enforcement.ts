import type { AuthorityDescriptor, AuthorizationLevel, InvocationAdmission } from "@kilnai/core";
import {
  assertBoundHostToolSandbox,
  createBoundHostToolSandbox,
  SandboxPolicy,
  type BoundHostToolSandbox,
} from "@kilnai/core/sandbox";
import type { EffectiveAuthorityAdmissionBundle } from "./effective-authority-admission-bundle.js";

export interface RuntimeHostToolEnforcement {
  readonly admissionId: EffectiveAuthorityAdmissionBundle["admissionId"];
  readonly sandboxId: `sha256:${string}`;
}

export interface RuntimeHostToolEnforcementBinding {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly sandbox: BoundHostToolSandbox;
  readonly invocationAdmission: InvocationAdmission;
  readonly parent?: RuntimeHostToolEnforcementBinding;
}

interface RuntimeHostToolEnforcementExpectation {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly sandbox: unknown;
  readonly invocationAdmission: InvocationAdmission | undefined;
}

const runtimeHostBindings = new WeakMap<object, RuntimeHostToolEnforcementBinding>();

/** Binds persisted evidence to the exact process-local effect enforcers. */
export function createRuntimeHostToolEnforcement(input: Omit<RuntimeHostToolEnforcementBinding, "parent">): RuntimeHostToolEnforcement {
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
  runtimeHostBindings.set(context,
    Object.freeze({ bundle: input.bundle, sandbox, invocationAdmission: input.invocationAdmission }),
  );
  return context;
}

/** Resolves the exact process-local binding after checking the persisted authority identity. */
export function resolveRuntimeHostToolEnforcement(
  value: unknown,
  expected: Pick<RuntimeHostToolEnforcementExpectation, "bundle">,
): RuntimeHostToolEnforcementBinding {
  if (value === null || typeof value !== "object") {
    throw new Error("A process-local Runtime host enforcement capability is required.");
  }
  const binding = runtimeHostBindings.get(value);
  if (!binding) throw new Error("A process-local Runtime host enforcement capability is required.");
  if (binding.bundle !== expected.bundle || binding.bundle.admissionId !== expected.bundle.admissionId) {
    throw new Error("Runtime host enforcement is stale or belongs to another authority admission.");
  }
  assertRootBindingEvidence(binding);
  return binding;
}

/** Derives an attenuated child capability from a real parent capability. */
export function deriveRuntimeHostToolEnforcement(input: {
  readonly parent: unknown;
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly childPolicy: SandboxPolicy;
  readonly childInvocationAdmission?: InvocationAdmission;
}): RuntimeHostToolEnforcement {
  const parent = resolveRuntimeHostToolEnforcement(input.parent, { bundle: input.bundle });
  const policy = new IntersectedSandboxPolicy(parent.sandbox.policy, input.childPolicy);
  const sandbox = createBoundHostToolSandbox({
    policy,
    leaseId: parent.sandbox.admission.leaseId,
    configurationRevisionId: parent.sandbox.admission.configurationRevisionId,
    permissionPolicyDigest: parent.sandbox.admission.permissionPolicyDigest,
  });
  const invocationAdmission = input.childInvocationAdmission
    ? composeInvocationAdmissions(parent.invocationAdmission, input.childInvocationAdmission)
    : parent.invocationAdmission;
  const context = Object.freeze({
    admissionId: input.bundle.admissionId,
    sandboxId: sandbox.admission.sandboxId,
  });
  runtimeHostBindings.set(context, Object.freeze({ bundle: input.bundle, sandbox, invocationAdmission, parent }));
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
  const binding = resolveRuntimeHostToolEnforcement(value, expected);
  const sandbox = assertBoundHostToolSandbox(expected.sandbox);
  if (binding.sandbox !== sandbox) {
    throw new Error("Runtime host enforcement does not bind the exact tool sandbox.");
  }
  if (binding.invocationAdmission !== expected.invocationAdmission) {
    throw new Error("Runtime host enforcement does not bind the exact invocation admission.");
  }
  return value as RuntimeHostToolEnforcement;
}

function assertRootBindingEvidence(binding: RuntimeHostToolEnforcementBinding): void {
  let root = binding;
  const seen = new Set<RuntimeHostToolEnforcementBinding>();
  while (root.parent !== undefined) {
    if (seen.has(root)) throw new Error("Runtime host enforcement lineage is cyclic.");
    seen.add(root);
    assertBoundHostToolSandbox(root.sandbox);
    root = root.parent;
  }
  assertBoundHostToolSandbox(root.sandbox);
  const admitted = root.bundle.turn.tools.hostEnforcement;
  if (!admitted ||
    JSON.stringify(admitted) !== JSON.stringify(root.sandbox.admission) ||
    root.bundle.configuration.turnRevision.revisionSetId !== admitted.configurationRevisionId
  ) {
    throw new Error("Runtime host enforcement evidence no longer matches its admitted sandbox.");
  }
}

class IntersectedSandboxPolicy extends SandboxPolicy {
  private readonly parent: SandboxPolicy;

  constructor(parent: SandboxPolicy, child: SandboxPolicy) {
    super({ config: child.config, projectPath: child.projectPath });
    this.parent = parent;
}

  override canRead(filePath: string): boolean {
    return this.parent.canRead(filePath) && super.canRead(filePath);
  }

  override canWrite(filePath: string): boolean {
    return this.parent.canWrite(filePath) && super.canWrite(filePath);
  }

  override canAccess(domain: string): boolean {
    return this.parent.canAccess(domain) && super.canAccess(domain);
  }

  override get admissionFingerprint(): unknown {
    return {
      kind: "runtime-host-policy-intersection",
      parent: this.parent.admissionFingerprint,
      child: super.admissionFingerprint,
    };
  }
}

function composeInvocationAdmissions(parent: InvocationAdmission, child: InvocationAdmission): InvocationAdmission {
  return Object.freeze({
    authorize(input: Parameters<InvocationAdmission["authorize"]>[0]) {
      return narrowAuthority(parent.authorize(input), child.authorize(input));
    },
  });
}

function narrowAuthority(left: AuthorityDescriptor, right: AuthorityDescriptor): AuthorityDescriptor {
  if (!left.allowed || !right.allowed) {
    return {
      level: maxAuthorityLevel(left.level, right.level),
      allowed: false,
      requiresApproval: left.requiresApproval || right.requiresApproval,
      reason: !left.allowed ? left.reason : right.reason,
    };
  }
  return {
    level: maxAuthorityLevel(left.level, right.level),
    allowed: true,
    requiresApproval: left.requiresApproval || right.requiresApproval,
    reason: `${left.reason}; ${right.reason}`,
  };
}

function maxAuthorityLevel(left: AuthorizationLevel, right: AuthorizationLevel): AuthorizationLevel {
  return Math.max(left, right) as AuthorizationLevel;
}
