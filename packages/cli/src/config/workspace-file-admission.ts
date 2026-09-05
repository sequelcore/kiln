import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { PhysicalPathResolver } from "@kilnai/core/sandbox";
import type { PermissionDecision, PermissionEvaluator } from "../wrapper/permission-evaluator.js";

export type WorkspaceFileAdmissionResult =
  | { readonly kind: "decision"; readonly decision: PermissionDecision }
  | { readonly kind: "denied"; readonly reason: string };

/**
 * Evaluates file governance against every meaningful spelling of a concrete
 * target. The Runtime supplies the execution workspace; tool input never gets
 * to select it.
 */
export function evaluateWorkspaceFileAdmission(input: {
  readonly evaluator: PermissionEvaluator;
  readonly physicalPathResolver: PhysicalPathResolver;
  readonly workingDirectory: string | undefined;
  readonly filePath: string;
}): WorkspaceFileAdmissionResult {
  if (!input.workingDirectory || !isAbsolute(input.workingDirectory)) {
    return {
      kind: "denied",
      reason: "Configured file admission requires an absolute execution workspace.",
    };
  }

  const lexicalWorkspace = resolve(input.workingDirectory);
  const physicalWorkspace = input.physicalPathResolver.resolve(lexicalWorkspace);
  if (!physicalWorkspace) {
    return {
      kind: "denied",
      reason: "Configured file admission could not resolve the execution workspace.",
    };
  }

  const normalizedInput = normalize(input.filePath);
  const lexicalTarget = resolve(lexicalWorkspace, input.filePath);
  const physicalTarget = input.physicalPathResolver.resolve(lexicalTarget);
  if (!physicalTarget) {
    return {
      kind: "denied",
      reason: "Configured file admission could not resolve the requested path.",
    };
  }

  const lexicalDecisions = evaluatePaths(input.evaluator, [
    input.filePath,
    normalizedInput,
    lexicalTarget,
  ]);
  const physicalDecisions = evaluatePaths(input.evaluator, [
    physicalTarget,
    relative(physicalWorkspace, physicalTarget),
  ]);
  const explicitDecisions = [...lexicalDecisions, ...physicalDecisions]
    .filter((decision) => decision.source !== "default");

  const denied = explicitDecisions.find((decision) => decision.action === "deny");
  if (denied) return { kind: "decision", decision: denied };

  const approval = explicitDecisions.find(
    (decision) => decision.action === "ask",
  );
  if (approval) return { kind: "decision", decision: approval };

  const lexicalGranted = lexicalDecisions.some((decision) => decision.source !== "default" && decision.action === "allow");
  const physicalGranted = physicalDecisions.some((decision) => decision.source !== "default" && decision.action === "allow");
  if (samePath(lexicalTarget, physicalTarget)) {
    const granted = [...lexicalDecisions, ...physicalDecisions]
      .find((decision) => decision.source !== "default" && decision.action === "allow");
    if (granted) return { kind: "decision", decision: granted };
  } else if (lexicalGranted && physicalGranted) {
    const granted = physicalDecisions.find((decision) => decision.source !== "default" && decision.action === "allow");
    if (granted) return { kind: "decision", decision: granted };
  }

  const defaultDecision = [...physicalDecisions, ...lexicalDecisions].find((decision) => decision.source === "default");
  if (defaultDecision) return { kind: "decision", decision: defaultDecision };
  return {
    kind: "denied",
    reason: "Configured file admission has no shared grant for the requested path.",
  };
}

function evaluatePaths(
  evaluator: PermissionEvaluator,
  paths: readonly string[],
): readonly PermissionDecision[] {
  return paths.map((path) => evaluator.evaluateFile(path));
}

function samePath(left: string, right: string): boolean {
  return pathIdentity(left) === pathIdentity(right);
}

function pathIdentity(path: string): string {
  const normalized = normalize(path).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
