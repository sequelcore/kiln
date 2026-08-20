import type { MemoryLayerKind } from "./record.js";
import type { MemoryScope, MemoryScopeKind } from "./scope.js";

export const MEMORY_AUTHORITY_ACCESS_LEVELS = [
  "read",
  "write",
] as const;

export type MemoryAuthorityAccessLevel = typeof MEMORY_AUTHORITY_ACCESS_LEVELS[number];

export const MEMORY_AUTHORITY_OPERATIONS = [
  "save",
  "read",
  "revise",
  "relate",
  "delete",
  "forget",
  "compact",
  "promote",
] as const;

export type MemoryAuthorityOperation = typeof MEMORY_AUTHORITY_OPERATIONS[number];

export interface MemoryAuthorityCaller {
  readonly kind: string;
  readonly id: string;
}

export interface MemoryAuthorityRule {
  readonly access: MemoryAuthorityAccessLevel;
  readonly operations: readonly MemoryAuthorityOperation[];
  readonly scopeKinds?: readonly MemoryScopeKind[];
  readonly scopeIds?: readonly string[];
  readonly layers?: readonly MemoryLayerKind[];
  readonly allowAuditWrite?: boolean;
}

export interface MemoryAuthorityPolicy {
  readonly caller: MemoryAuthorityCaller;
  readonly rules: readonly MemoryAuthorityRule[];
}

/**
 * An explicit boundary for memory access.
 *
 * A missing policy is not a permission.  Model-facing callers use the
 * governed branch; trusted infrastructure must opt in through the factory
 * below so unrestricted access cannot be introduced by omission.
 */
export type MemoryAuthorityBoundary =
  | {
    readonly kind: "governed";
    readonly policy: MemoryAuthorityPolicy;
  }
  | {
    readonly kind: "trusted-internal";
    readonly token: TrustedInternalMemoryAuthority;
  };

/** Nominal capability created only for explicitly trusted infrastructure. */
export class TrustedInternalMemoryAuthority {
  private constructor() {}

  private declare readonly brand: undefined;

  static create(): TrustedInternalMemoryAuthority {
    return new TrustedInternalMemoryAuthority();
  }
}

export function governedMemoryAuthority(policy: MemoryAuthorityPolicy): MemoryAuthorityBoundary {
  return { kind: "governed", policy: defineMemoryAuthorityPolicy(policy) };
}

export function trustedInternalMemoryAuthority(): MemoryAuthorityBoundary {
  return {
    kind: "trusted-internal",
    token: TrustedInternalMemoryAuthority.create(),
  };
}

export interface MemoryAuthorityWriteRequest {
  readonly operation: MemoryAuthorityOperation;
  readonly scope: MemoryScope;
  readonly layer: MemoryLayerKind;
}

export interface MemoryAuthorityReadRequest {
  readonly operation: MemoryAuthorityOperation;
  readonly requestedScope?: MemoryScope;
  readonly requestedLayer?: MemoryLayerKind;
  readonly actualScope?: MemoryScope;
  readonly actualLayer?: MemoryLayerKind;
  readonly requireScope?: boolean;
}

export function defineMemoryAuthorityPolicy(input: MemoryAuthorityPolicy): MemoryAuthorityPolicy {
  return {
    caller: defineCaller(input.caller),
    rules: input.rules.map((rule) => defineRule(rule)),
  };
}

export function assertMemoryWriteAuthorized(
  policy: MemoryAuthorityPolicy,
  request: MemoryAuthorityWriteRequest,
): void {
  const decision = evaluateMemoryWriteAuthority(policy, request);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
}

export function evaluateMemoryWriteAuthority(
  policy: MemoryAuthorityPolicy,
  request: MemoryAuthorityWriteRequest,
): {
  readonly allowed: true;
} | {
  readonly allowed: false;
  readonly reason: string;
} {
  let scopeDenied = false;
  let layerDenied = false;
  let auditDenied = false;
  let operationDenied = true;

  for (const rule of policy.rules) {
    if (rule.access !== "write") {
      continue;
    }

    if (!rule.operations.includes(request.operation)) {
      continue;
    }
    operationDenied = false;

    if (rule.scopeKinds !== undefined && !rule.scopeKinds.includes(request.scope.kind)) {
      scopeDenied = true;
      continue;
    }

    if (rule.scopeIds !== undefined && !rule.scopeIds.includes(request.scope.id)) {
      scopeDenied = true;
      continue;
    }

    if (rule.layers !== undefined && !rule.layers.includes(request.layer)) {
      layerDenied = true;
      continue;
    }

    if (request.layer === "audit" && rule.allowAuditWrite !== true) {
      auditDenied = true;
      continue;
    }

    return { allowed: true };
  }

  const caller = `${policy.caller.kind}:${policy.caller.id}`;
  if (auditDenied) {
    return { allowed: false, reason: `Memory write denied for ${caller}: audit layer requires explicit permission` };
  }
  if (layerDenied) {
    return { allowed: false, reason: `Memory write denied for ${caller}: layer is not authorized` };
  }
  if (scopeDenied) {
    return { allowed: false, reason: `Memory write denied for ${caller}: scope is not authorized` };
  }
  if (operationDenied) {
    return { allowed: false, reason: `Memory write denied for ${caller}: operation is not authorized` };
  }
  return { allowed: false, reason: `Memory write denied for ${caller}` };
}

export function assertMemoryReadAuthorized(
  policy: MemoryAuthorityPolicy,
  request: MemoryAuthorityReadRequest,
): void {
  const decision = evaluateMemoryReadAuthority(policy, request);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
}

export function evaluateMemoryReadAuthority(
  policy: MemoryAuthorityPolicy,
  request: MemoryAuthorityReadRequest,
): {
  readonly allowed: true;
} | {
  readonly allowed: false;
  readonly reason: string;
} {
  let scopeDenied = false;
  let layerDenied = false;
  let operationDenied = true;

  if (request.requireScope && !request.requestedScope && !request.actualScope) {
    const caller = `${policy.caller.kind}:${policy.caller.id}`;
    return { allowed: false, reason: `Memory read denied for ${caller}: scope is required` };
  }

  for (const rule of policy.rules) {
    if (rule.access !== "read") {
      continue;
    }

    if (!rule.operations.includes(request.operation)) {
      continue;
    }
    operationDenied = false;

    if (!rule.scopeKinds || !rule.scopeIds || !rule.layers) {
      continue;
    }

    if (request.requestedScope && !scopeAllowed(rule, request.requestedScope)) {
      scopeDenied = true;
      continue;
    }
    if (request.actualScope && !scopeAllowed(rule, request.actualScope)) {
      scopeDenied = true;
      continue;
    }

    if (request.requestedLayer && !rule.layers.includes(request.requestedLayer)) {
      layerDenied = true;
      continue;
    }
    if (request.actualLayer && !rule.layers.includes(request.actualLayer)) {
      layerDenied = true;
      continue;
    }

    return { allowed: true };
  }

  const caller = `${policy.caller.kind}:${policy.caller.id}`;
  if (layerDenied) {
    return { allowed: false, reason: `Memory read denied for ${caller}: layer is not authorized` };
  }
  if (scopeDenied) {
    return { allowed: false, reason: `Memory read denied for ${caller}: scope is not authorized` };
  }
  if (operationDenied) {
    return { allowed: false, reason: `Memory read denied for ${caller}: operation is not authorized` };
  }
  return { allowed: false, reason: `Memory read denied for ${caller}` };
}

export function isMemoryAuthorityOperation(value: string): value is MemoryAuthorityOperation {
  return (MEMORY_AUTHORITY_OPERATIONS as readonly string[]).includes(value);
}

function defineCaller(input: MemoryAuthorityCaller): MemoryAuthorityCaller {
  const kind = requireText(input.kind, "Memory authority caller kind is required");
  const id = requireText(input.id, "Memory authority caller id is required");
  return { kind, id };
}

function defineRule(input: MemoryAuthorityRule): MemoryAuthorityRule {
  if (!MEMORY_AUTHORITY_ACCESS_LEVELS.includes(input.access)) {
    throw new Error(`Unsupported memory authority access level: ${input.access as string}`);
  }

  const operations = input.operations.map((operation) => {
    if (!isMemoryAuthorityOperation(operation as string)) {
      throw new Error(`Unsupported memory authority operation: ${operation as string}`);
    }
    return operation;
  });
  if (operations.length === 0) {
    throw new Error("Memory authority rule must include at least one operation");
  }

  if (input.access === "read" && operations.includes("read")) {
    if (!input.scopeKinds || input.scopeKinds.length === 0) {
      throw new Error("Memory read authority rules must constrain scopeKinds");
    }
    if (!input.scopeIds || input.scopeIds.length === 0) {
      throw new Error("Memory read authority rules must constrain scopeIds");
    }
    if (!input.layers || input.layers.length === 0) {
      throw new Error("Memory read authority rules must constrain layers");
    }
  }

  const scopeIds = input.scopeIds?.map((scopeId) => requireText(scopeId, "Memory authority scope id is required"));
  return {
    ...input,
    operations,
    ...(scopeIds !== undefined ? { scopeIds } : {}),
  };
}

function scopeAllowed(rule: MemoryAuthorityRule, scope: MemoryScope): boolean {
  return !!rule.scopeKinds?.includes(scope.kind) && !!rule.scopeIds?.includes(scope.id);
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
