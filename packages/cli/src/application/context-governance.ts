import type { ProjectedContext } from "./context-types.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import type { SessionContext } from "../wrapper/index.js";

export function governProjectedContext(
  projectedContext: ProjectedContext,
  permissionPolicy: KilnPermissionPolicy,
): ProjectedContext {
  if (permissionPolicy.fileGovernance?.excludeFromContext !== true) {
    return projectedContext;
  }

  const blocks = projectedContext.blocks.filter((block) => block.kind !== "memory");
  return {
    blocks,
    estimatedTokens: blocks.reduce((total, block) => total + (block.estimatedTokens ?? 0), 0),
    tokenBudget: projectedContext.tokenBudget,
    deferredBlocks: projectedContext.deferredBlocks?.filter((block) => block.kind !== "memory"),
    overflow: projectedContext.overflow,
  };
}

export function governSessionContext(
  context: SessionContext,
  permissionPolicy: KilnPermissionPolicy,
): SessionContext {
  return {
    ...context,
    projectedContext: governProjectedContext(context.projectedContext, permissionPolicy),
  };
}
