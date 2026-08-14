declare const EXECUTION_ACCOUNT_REF: unique symbol;
declare const EXECUTION_ACCOUNT_POLICY_ID: unique symbol;

/** Opaque configured-account identity; it never contains credential material. */
export type ExecutionAccountRef = string & { readonly [EXECUTION_ACCOUNT_REF]: "ExecutionAccountRef" };

/** Canonical identity of a configured execution-account selection policy. */
export type ExecutionAccountPolicyId = string & { readonly [EXECUTION_ACCOUNT_POLICY_ID]: "ExecutionAccountPolicyId" };

export function createExecutionAccountRef(value: string): ExecutionAccountRef {
  const canonical = value.trim();
  if (canonical.length === 0) throw new TypeError("ExecutionAccountRef must not be empty.");
  return canonical as ExecutionAccountRef;
}

export function createExecutionAccountPolicyId(value: string): ExecutionAccountPolicyId {
  if (typeof value !== "string") throw new TypeError("ExecutionAccountPolicyId must not be empty.");
  const canonical = value.trim();
  if (canonical.length === 0) throw new TypeError("ExecutionAccountPolicyId must not be empty.");
  return canonical as ExecutionAccountPolicyId;
}
