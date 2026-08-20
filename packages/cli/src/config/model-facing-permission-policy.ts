import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { createPermissionEvaluator } from "../wrapper/permission-evaluator.js";

/**
 * The one model-facing permission posture used when no composed policy exists.
 *
 * Surfaces must resolve this value once and pass the resulting policy through
 * to every session they create.  Keeping the fallback here prevents a GUI,
 * TUI, or bootstrap helper from becoming a second policy authority.
 */
export const MODEL_FACING_DEFAULT_PERMISSION_POLICY = Object.freeze({
  approval: "on-request",
  sandbox: "read-only",
  safeDefaults: true,
  auditLog: true,
} satisfies KilnPermissionPolicy);

export function resolveModelFacingPermissionPolicy(
  policy: KilnPermissionPolicy | undefined,
): KilnPermissionPolicy {
  if (!policy) return MODEL_FACING_DEFAULT_PERMISSION_POLICY;
  return {
    ...MODEL_FACING_DEFAULT_PERMISSION_POLICY,
    ...policy,
  };
}

const BENCHMARK_MUTATING_TOOLS = ["write", "edit", "patch"] as const;

/**
 * Derives the benchmark posture from the already admitted model-facing
 * policy. Read benchmarks attenuate mutation; write benchmarks never add
 * authority and require every exposed mutating tool to be explicitly allowed.
 */
export function resolveBenchmarkPermissionPolicy(
  policy: KilnPermissionPolicy | undefined,
  mode: "read-only" | "write",
): KilnPermissionPolicy {
  const resolved = resolveModelFacingPermissionPolicy(policy);
  if (mode === "read-only") {
    return {
      ...resolved,
      sandbox: "read-only",
      tools: [
        ...(resolved.tools ?? []),
        ...BENCHMARK_MUTATING_TOOLS.map((tool) => ({ tool, action: "deny" as const })),
      ],
    };
  }

  const sandboxRank = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const;
  const sandbox = resolved.sandbox ?? "read-only";
  if (sandboxRank[sandbox] < sandboxRank["workspace-write"]) {
    throw new Error("Benchmark write profile requires admitted workspace-write or danger-full-access authority.");
  }
  const evaluator = createPermissionEvaluator(resolved);
  const unavailable = BENCHMARK_MUTATING_TOOLS
    .map((tool) => ({ tool, decision: evaluator.evaluateTool(tool) }))
    .filter(({ decision }) => decision.action !== "allow");
  if (unavailable.length > 0) {
    throw new Error(
      `Benchmark write profile lacks admitted write authority for: ${unavailable.map(({ tool }) => tool).join(", ")}.`,
    );
  }
  return resolved;
}
