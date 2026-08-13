import {
  sha256ContentIdentity,
  resolveCommunicationIntent,
  type CommunicationIntent,
  type CommunicationIntentCandidate,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";
import { createHash } from "node:crypto";

export interface AdmittedCommunicationEvidenceInput {
  readonly outputSchema?: string | Uint8Array;
  readonly projectedBlocks: readonly { readonly source: string; readonly content: string }[];
  readonly requestedAuthority?: string;
}

/** Builds high-precedence candidates only from outputs already admitted by their owning boundary. */
export function admittedCommunicationEvidence(
  input: AdmittedCommunicationEvidenceInput,
): Pick<ConfiguredCommunicationInput, "artifactContract" | "responseSkill" | "safetyAuthority"> {
  const responseSkills = input.projectedBlocks
    .filter((block) => block.source.startsWith("runtime-skill:"))
    .flatMap((block) => {
      const name = /^Skill\r?\nname: ([^\r\n]+)/u.exec(block.content)?.[1]?.trim();
      return name ? [{ id: name, revision: sha256ContentIdentity(block.content) }] : [];
    });
  return {
    ...(input.outputSchema ? {
      artifactContract: {
        artifactContract: {
          id: "structured-output-schema",
          revision: `sha256:${createHash("sha256").update(input.outputSchema).digest("hex")}`,
        },
      },
    } : {}),
    ...(responseSkills.length > 0 ? { responseSkill: { responseSkills } } : {}),
    ...(input.requestedAuthority === "destructive"
      ? { safetyAuthority: { requiredContent: ["approval-requirement"] } }
      : {}),
  };
}

export interface ConfiguredCommunicationInput {
  readonly global?: CommunicationIntent;
  readonly project?: CommunicationIntent;
  readonly agent?: CommunicationIntent;
  readonly invocation?: CommunicationIntent;
  readonly responseSkill?: CommunicationIntent;
  readonly artifactContract?: CommunicationIntent;
  readonly user?: CommunicationIntent;
  readonly safetyAuthority?: CommunicationIntent;
}

/** Composes every persisted and turn-local source without losing provenance. */
export function resolveConfiguredCommunication(
  input: ConfiguredCommunicationInput,
): ResolvedCommunicationIntent {
  return resolveCommunicationIntent(configuredCommunicationCandidates(input));
}

/** Preserves source provenance for Runtime surfaces that add a turn-local user candidate. */
export function configuredCommunicationCandidates(
  input: ConfiguredCommunicationInput,
): readonly CommunicationIntentCandidate[] {
  const candidates = [
    ...(input.safetyAuthority ? [{ source: "safety-authority" as const, intent: input.safetyAuthority }] : []),
    ...(input.user ? [{ source: "user" as const, intent: input.user }] : []),
    ...(input.artifactContract ? [{ source: "artifact-contract" as const, intent: input.artifactContract }] : []),
    ...(input.responseSkill ? [{ source: "response-skill" as const, intent: input.responseSkill }] : []),
    ...(input.invocation ? [{ source: "invocation" as const, intent: input.invocation }] : []),
    ...(input.agent ? [{ source: "agent-profile" as const, intent: input.agent }] : []),
    ...(input.project ? [{ source: "project" as const, intent: input.project }] : []),
    ...(input.global ? [{ source: "global" as const, intent: input.global }] : []),
  ];
  return candidates;
}
