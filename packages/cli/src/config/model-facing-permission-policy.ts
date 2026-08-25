import { createHash } from "node:crypto";
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

/** Secret-free canonical identity for the exact model-facing policy object. */
export function digestKilnPermissionPolicy(policy: KilnPermissionPolicy): `sha256:${string}` {
  const canonical = canonicalJsonValue(policy);
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => [key, canonicalJsonValue(child)]));
  }
  return value;
}

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
