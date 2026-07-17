import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
  KilnConfigAppliedWrite,
  KilnConfigApplyResult,
  KilnConfigProjectionEffectResult,
  KilnConfigValidationDiagnostic,
} from "@kilnai/gateway-contracts";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";
import { ConfigMutationStore } from "./config-mutation-store.js";
import { hashText } from "./config-proposal.js";

export interface ApplyConfigChangeInput {
  readonly projectPath: string;
  readonly proposalId: string;
  readonly approvalId: string;
  readonly now?: Date;
}

export async function applyConfigChange(input: ApplyConfigChangeInput): Promise<KilnConfigApplyResult> {
  const appliedAt = (input.now ?? new Date()).toISOString();
  const store = new ConfigMutationStore(input.projectPath);
  const record = store.readProposal(input.proposalId);
  const approval = store.readApproval(input.approvalId);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];

  if (!record) {
    return failed(input, appliedAt, [{ severity: "error", field: "proposalId", message: "Config proposal not found." }]);
  }
  if (!approval) {
    return failed(input, appliedAt, [{ severity: "error", field: "approvalId", message: "Config approval not found." }]);
  }
  if (record.proposal.status !== "valid") {
    return failed(input, appliedAt, [{ severity: "error", field: "proposal", message: "Only valid config proposals can be applied." }]);
  }
  if (approval.status !== "approved") {
    return failed(input, appliedAt, [{ severity: "error", field: "approvalId", message: "Config approval is not active." }]);
  }
  if (approval.proposalId !== input.proposalId || approval.proposalHash !== record.proposalHash) {
    return failed(input, appliedAt, [{ severity: "error", field: "approvalId", message: "Config approval does not match the stored proposal." }]);
  }

  const pathDiagnostics = validateWritePaths(input.projectPath, record.writes.map((write) => write.path));
  if (pathDiagnostics.length > 0) {
    return failed(input, appliedAt, pathDiagnostics);
  }

  for (const write of record.writes) {
    const currentHash = existsSync(write.path) ? hashText(readFileSync(write.path, "utf-8")) : null;
    if (currentHash !== write.previousHash) {
      diagnostics.push({
        severity: "error",
        field: write.path,
        message: "Config proposal is stale; canonical file changed after proposal creation.",
      });
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failed(input, appliedAt, diagnostics);
  }

  const appliedWrites: KilnConfigAppliedWrite[] = [];
  try {
    for (const write of record.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.nextContent, "utf-8");
      appliedWrites.push({
        path: write.path,
        previousHash: write.previousHash,
        nextHash: write.nextHash,
      });
    }
  } catch (error) {
    return failed(input, appliedAt, [{
      severity: "error",
      field: "write",
      message: error instanceof Error ? error.message : String(error),
    }], appliedWrites);
  }

  const projectionEffects = await syncConfigMutationProjections(input.projectPath, record.proposal.operation);
  for (const effect of projectionEffects) {
    for (const error of effect.errors) {
      diagnostics.push({ severity: "warning", field: effect.target, message: error });
    }
  }

  store.markApprovalConsumed(approval, appliedAt);
  return {
    proposalId: input.proposalId,
    approvalId: input.approvalId,
    appliedAt,
    status: "applied",
    appliedWrites,
    projectionEffects,
    diagnostics,
  };
}

async function syncConfigMutationProjections(
  projectPath: string,
  operation: string,
): Promise<readonly KilnConfigProjectionEffectResult[]> {
  const effects: KilnConfigProjectionEffectResult[] = [];
  const disabledHarnesses = [] as const;
  if (operation === "agent.upsert" || operation === "agent.attach_skills") {
    const result = await syncNativeAgentProjections(projectPath, { disabledHarnesses });
    effects.push({
      target: "native-agents",
      status: result.errors.length === 0 ? "ok" : "failed",
      summary: `${result.synced} native agent projections synced`,
      errors: result.errors,
    });
  }
  if (operation === "skill.upsert") {
    const result = await syncNativeSkillProjections(projectPath, { disabledHarnesses });
    effects.push({
      target: "native-skills",
      status: result.errors.length === 0 ? "ok" : "failed",
      summary: `${result.synced} native skill projections synced`,
      errors: result.errors,
    });
  }

  const shimResult = await writeRepoShimProjections(projectPath);
  effects.push({
    target: "repo-shims",
    status: shimResult.errors.length === 0 ? "ok" : "failed",
    summary: `${shimResult.targets.filter((target) => target.status === "written").length} repo shim projections written`,
    errors: shimResult.errors,
  });
  return effects;
}

function validateWritePaths(projectPath: string, paths: readonly string[]): readonly KilnConfigValidationDiagnostic[] {
  const projectRoot = resolve(projectPath);
  const canonicalRoots = [
    resolve(join(projectRoot, ".kiln", "agents")),
    resolve(join(projectRoot, ".kiln", "skills")),
  ];
  const canonicalFiles = new Set([resolve(join(projectRoot, ".kiln", "kiln.yaml"))]);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  for (const path of paths) {
    const resolvedPath = resolve(path);
    if (!canonicalFiles.has(resolvedPath) && !canonicalRoots.some((root) => isInside(root, resolvedPath))) {
      diagnostics.push({
        severity: "error",
        field: path,
        message: "Config apply can only write project .kiln/agents, .kiln/skills, or .kiln/kiln.yaml canonical configuration.",
      });
      continue;
    }
    if (!isPhysicallyInsideProject(projectRoot, resolvedPath)) {
      diagnostics.push({
        severity: "error",
        field: path,
        message: "Config apply refused a canonical path whose physical target escapes the project root.",
      });
    }
  }
  return diagnostics;
}

function isPhysicallyInsideProject(projectRoot: string, candidate: string): boolean {
  try {
    const realProjectRoot = realpathSync(projectRoot);
    let existingAncestor = candidate;
    while (!existsSync(existingAncestor)) {
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) return false;
      existingAncestor = parent;
    }
    const realAncestor = realpathSync(existingAncestor);
    const physicalCandidate = resolve(realAncestor, relative(existingAncestor, candidate));
    return isInside(realProjectRoot, physicalCandidate);
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !/^[A-Za-z]:/.test(relativePath));
}

function failed(
  input: ApplyConfigChangeInput,
  appliedAt: string,
  diagnostics: readonly KilnConfigValidationDiagnostic[],
  appliedWrites: readonly KilnConfigAppliedWrite[] = [],
): KilnConfigApplyResult {
  return {
    proposalId: input.proposalId,
    approvalId: input.approvalId,
    appliedAt,
    status: "failed",
    appliedWrites,
    projectionEffects: [],
    diagnostics,
  };
}
