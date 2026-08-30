import { createHash } from "node:crypto";
import type {
  CapabilityParticipation,
  OperatorAdoptionAdmission,
  SkillCatalogAdmission,
  WorkGovernanceAdmission,
} from "../session/effective-authority-admission-bundle.js";
import type { EffectiveTurnAuthorityPolicyBound } from "../session/runtime-session-orchestrator.types.js";
import {
  deriveTurnEffectCeiling,
  projectToolPermissionAdmissionFromPerCallConfig,
} from "../session/effective-authority-admission-bundle.js";
import type { RuntimeAuthorityAdmissionCandidateConfig } from "../session/runtime-session-orchestrator.types.js";
import type { RuntimeSession } from "../session/runtime-session.js";
import type {
  OperatorSessionAuthorityAdmissionFacets,
  OperatorSessionExecutionTargetCatalogSnapshot,
} from "./operator-session-execution-routing-service.js";
import type { ActionEffectEnvelope } from "@kilnai/core/engine";

export function defineOperatorAuthorityAdmissionFacets(input: {
  readonly executionId: string;
  readonly turnId?: string;
  readonly session: RuntimeSession;
  readonly snapshot: OperatorSessionExecutionTargetCatalogSnapshot;
  readonly perCallConfig: RuntimeAuthorityAdmissionCandidateConfig;
  readonly candidateToolNames: readonly string[];
  readonly skillCatalog: SkillCatalogAdmission;
  readonly authorityCeiling: EffectiveTurnAuthorityPolicyBound;
  readonly workGovernance?: WorkGovernanceAdmission;
  readonly operatorAdoption: OperatorAdoptionAdmission;
  readonly capabilityParticipation: CapabilityParticipation;
  readonly effectCeiling?: ActionEffectEnvelope;
}): OperatorSessionAuthorityAdmissionFacets {
  const authority = input.perCallConfig.effectiveTurnAuthority;
  if (!authority || authority.completeness !== "authoritative") {
    throw new Error("Operator turn authority projection is incomplete.");
  }
  const sessionRevision = input.session.runtimeConfigurationRevision
    ?? input.session.bindRuntimeConfigurationRevision(input.snapshot.configurationRevision);
  const tools = projectToolPermissionAdmissionFromPerCallConfig({
    candidateToolNames: input.candidateToolNames,
    config: input.perCallConfig,
  });
  const authorityCeiling = input.session.runtimeSessionAuthorityFacet?.authorityCeiling
    ?? input.authorityCeiling;
  const skillCatalog = input.session.runtimeSessionAuthorityFacet?.skillCatalog
    ?? input.skillCatalog;
  return {
    sessionId: input.session.id,
    turnId: input.turnId ?? input.executionId,
    sessionRevision,
    session: { skillCatalog, authorityCeiling },
    turn: {
      authority,
      workGovernance: input.workGovernance ?? { status: "not-required" },
      operatorAdoption: input.operatorAdoption,
      capabilityParticipation: input.capabilityParticipation,
      tools,
      effectCeiling: input.effectCeiling ?? deriveTurnEffectCeiling(tools),
    },
  };
}

export function defineOperatorSkillCatalogAdmission(skillIdsInput: readonly string[]): SkillCatalogAdmission {
  const skillIds: readonly string[] = Object.freeze([...new Set(skillIdsInput)].sort());
  return Object.freeze({
    catalogId: "runtime-session-skills",
    revision: `sha256:${createHash("sha256").update(JSON.stringify(skillIds)).digest("hex")}`,
    skillIds,
  });
}
