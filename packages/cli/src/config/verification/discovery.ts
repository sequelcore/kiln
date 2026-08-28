import { createHash } from "node:crypto";
import type {
  VerificationCapabilityDiscoveryInput,
  VerificationProducerDiagnostic,
  VerificationProducerResolution,
} from "@kilnai/core/capabilities";
import {
  FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
  GENTLE_REVIEW_CONTRACT,
  STATIC_ANALYSIS_PROFILE,
  STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
} from "@kilnai/core/verification";
import type { FormalVerificationConfigurationResolution } from "./dafny.js";
import type { GentleAiConfigurationResolution } from "./gentle-ai.js";
import type { StaticAnalysisConfigurationResolution } from "./oxlint.js";
import type { QualityAnalysisConfigurationResolution } from "./quality.js";

export interface ProjectVerificationDiscoveryInput {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly formal: FormalVerificationConfigurationResolution;
  readonly staticAnalysis: StaticAnalysisConfigurationResolution;
  readonly quality: QualityAnalysisConfigurationResolution;
  readonly inferential: GentleAiConfigurationResolution;
}

type ConfiguredVerificationDiagnostic = NonNullable<
  (
    | FormalVerificationConfigurationResolution
    | StaticAnalysisConfigurationResolution
    | QualityAnalysisConfigurationResolution
    | GentleAiConfigurationResolution
  )["diagnostic"]
>;

/**
 * Projects already-resolved verifier evidence into Core's inert discovery
 * contract. It cannot execute a verifier, inspect PATH, or expose an
 * executable location because none of those values cross the output boundary.
 */
export function projectVerificationDiscoveryInput(
  input: ProjectVerificationDiscoveryInput,
): VerificationCapabilityDiscoveryInput {
  return {
    evaluatedAt: input.observedAt,
    producers: {
      formal_verify: projectFormal(input.formal, input),
      static_analyze: projectStatic(input.staticAnalysis, input),
      quality_analyze: projectQuality(input.quality, input),
      gentle_review: projectGentle(input.inferential, input),
    },
  };
}

function projectFormal(
  resolution: FormalVerificationConfigurationResolution,
  time: Pick<ProjectVerificationDiscoveryInput, "observedAt" | "validUntil">,
): VerificationProducerResolution {
  if (resolution.options && resolution.identity) {
    return available(
      time,
      resolution.identity.version,
      FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
      resolution.identity.installationDigest,
      digest(`dafny/${resolution.identity.version}/${resolution.identity.installationDigest}`),
    );
  }
  return unavailable(resolution.diagnostic);
}

function projectStatic(
  resolution: StaticAnalysisConfigurationResolution,
  time: Pick<ProjectVerificationDiscoveryInput, "observedAt" | "validUntil">,
): VerificationProducerResolution {
  if (resolution.options && resolution.identity) {
    const implementationDigest = digest(
      `oxlint/${resolution.identity.version}/${resolution.identity.executableDigest}/${resolution.identity.profileConfigDigest}`,
    );
    return available(
      time,
      resolution.identity.version,
      STATIC_ANALYSIS_PROFILE,
      implementationDigest,
      digest(
        `oxlint-source/${resolution.identity.sourceArchiveDigest}/${STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST}`,
      ),
    );
  }
  return unavailable(resolution.diagnostic);
}

function projectQuality(
  resolution: QualityAnalysisConfigurationResolution,
  time: Pick<ProjectVerificationDiscoveryInput, "observedAt" | "validUntil">,
): VerificationProducerResolution {
  if (resolution.options) {
    const implementationDigest = digest(
      `kiln-quality/${resolution.options.analyzerVersion}/${resolution.options.profiles.join(",")}`,
    );
    return available(
      time,
      resolution.options.analyzerVersion,
      resolution.options.profiles,
      implementationDigest,
      digest(`kiln-release/${resolution.options.analyzerVersion}/quality-profiles`),
    );
  }
  return unavailable(resolution.diagnostic);
}

function projectGentle(
  resolution: GentleAiConfigurationResolution,
  time: Pick<ProjectVerificationDiscoveryInput, "observedAt" | "validUntil">,
): VerificationProducerResolution {
  if (resolution.options) {
    const implementationDigest = resolution.options.expectedExecutableDigest as `sha256:${string}`;
    return available(
      time,
      resolution.options.expectedVersion,
      GENTLE_REVIEW_CONTRACT,
      implementationDigest,
      digest(`gentle-ai/${resolution.options.expectedVersion}/${implementationDigest}/${GENTLE_REVIEW_CONTRACT}`),
    );
  }
  return unavailable(resolution.diagnostic);
}

function available(
  time: Pick<ProjectVerificationDiscoveryInput, "observedAt" | "validUntil">,
  version: string,
  profile: string | readonly string[],
  implementationDigest: `sha256:${string}`,
  provenanceDigest: `sha256:${string}`,
): VerificationProducerResolution {
  return {
    status: "available",
    observedAt: time.observedAt,
    validUntil: time.validUntil,
    version,
    profile,
    implementationDigest,
    provenanceDigest,
  };
}

function unavailable(
  diagnostic: ConfiguredVerificationDiagnostic | undefined,
): VerificationProducerResolution {
  if (!diagnostic) return { status: "invalid", diagnostic: { code: "invalid_declaration" } };
  const status = diagnostic.code === "not_configured"
    ? "unavailable"
    : diagnostic.code === "executable_unavailable" || diagnostic.code === "managed_artifact_unavailable"
      ? "configured_unavailable"
      : "validation_failed";
  return {
    status,
    diagnostic: safeDiagnostic(diagnostic),
  };
}

function safeDiagnostic(
  diagnostic: ConfiguredVerificationDiagnostic,
): VerificationProducerDiagnostic {
  const expectedVersion = diagnosticVersion(diagnostic, "expectedVersion");
  const observedVersion = diagnosticVersion(diagnostic, "observedVersion");
  return {
    code: diagnostic.code,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(observedVersion === undefined ? {} : { observedVersion }),
  };
}

function diagnosticVersion(
  diagnostic: ConfiguredVerificationDiagnostic,
  field: "expectedVersion" | "observedVersion",
): string | undefined {
  if (!(field in diagnostic)) return undefined;
  const value = (diagnostic as unknown as Readonly<Record<string, unknown>>)[field];
  return typeof value === "string" ? value : undefined;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
