import type {
  AttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";
import type {
  EffectiveTurnAuthoritySnapshot,
  RuntimeBuiltinToolExecutionContext,
} from "../../src/session/runtime-session-orchestrator.types.js";

export function withAdmittedRuntimeCalls(
  surface: AttachedRuntimeBuiltinToolSurface,
  options: {
    readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
    readonly preserveMissingContext?: boolean;
  } = {},
): AttachedRuntimeBuiltinToolSurface {
  const callBuiltinTools = new Map(surface.callBuiltinTools);

  for (const [toolName, executor] of surface.callBuiltinTools) {
    callBuiltinTools.set(toolName, async (input, context) => {
      if (options.preserveMissingContext && !context) return executor(input, context);
      const projectedAuthority = surface.toolAuthority.get(toolName);
      const authority = context?.authority ?? (projectedAuthority
        ? {
            ...projectedAuthority,
            allowed: true,
            requiresApproval: false,
            reason: "Runtime test fixture admits this exact invocation.",
          }
        : undefined);
      const resolvedEffect = context?.resolvedEffect
        ?? surface.capabilities.get(toolName)?.effectEnvelope;

      return executor(input, {
        ...(context ?? {}),
        ...(authority ? { authority } : {}),
        ...(resolvedEffect ? { resolvedEffect } : {}),
        ...(context?.effectiveTurnAuthority
          ? { effectiveTurnAuthority: context.effectiveTurnAuthority }
          : options.effectiveTurnAuthority
            ? { effectiveTurnAuthority: options.effectiveTurnAuthority }
            : {}),
      } as RuntimeBuiltinToolExecutionContext);
    });
  }

  return { ...surface, callBuiltinTools };
}
