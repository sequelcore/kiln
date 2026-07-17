export type BenchmarkSurface =
  | "tool-calling"
  | "managed-child"
  | "managed-team"
  | "managed-coding"
  | "safety";

export type BenchmarkTrackId =
  | "bfcl"
  | "agentdojo"
  | "tau"
  | "terminal-bench"
  | "swe-bench"
  | "webarena"
  | "osworld";

export type BenchmarkReadinessStatus =
  | "blocked"
  | "internal-baseline-ready"
  | "external-ready";

export type BenchmarkEvidenceArtifactKind =
  | "result"
  | "transcript"
  | "tool-calls"
  | "diagnostics"
  | "usage"
  | "route"
  | "cost"
  | "cache-topology";

export interface BenchmarkEvidenceArtifact {
  readonly kind: BenchmarkEvidenceArtifactKind;
  readonly uri: string;
}

export interface BenchmarkProfile {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly surface: BenchmarkSurface;
  readonly purpose: string;
  readonly authorityProfile: string;
  readonly requiredScorers: readonly string[];
  readonly minimumPassAtK: number;
  readonly minimumK: number;
  readonly reproducibilityRequirements: readonly string[];
  readonly externalTrackCandidates: readonly BenchmarkTrackId[];
}

export interface BenchmarkBaselineResult {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly datasetName: string;
  readonly k: number;
  readonly passAtK: number;
  readonly scorers: readonly string[];
  readonly artifactUris: readonly string[];
  readonly evidenceArtifacts: readonly BenchmarkEvidenceArtifact[];
  readonly configHash: string;
  readonly datasetVersion: string;
}

export interface BenchmarkTrack {
  readonly id: BenchmarkTrackId;
  readonly displayName: string;
  readonly purpose: string;
  readonly status: "candidate" | "blocked-until-profile" | "blocked-until-adapter";
  readonly requiredProfileSurfaces: readonly BenchmarkSurface[];
}

export interface BenchmarkReadinessInput {
  readonly profiles?: readonly BenchmarkProfile[];
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly tracks?: readonly BenchmarkTrack[];
}

export interface BenchmarkProfileReadiness {
  readonly profileId: string;
  readonly status: BenchmarkReadinessStatus;
  readonly issues: readonly string[];
  readonly baseline?: BenchmarkBaselineResult;
}

export interface BenchmarkReadinessReport {
  readonly status: BenchmarkReadinessStatus;
  readonly profileReadiness: readonly BenchmarkProfileReadiness[];
  readonly externalReadyTracks: readonly BenchmarkTrackId[];
  readonly blockedTracks: readonly BenchmarkTrackId[];
  readonly issues: readonly string[];
}

export const KILN_BENCHMARK_PROFILES: readonly BenchmarkProfile[] = [
  {
    id: "kiln-tool-agent",
    version: "3",
    displayName: "Kiln Tool Agent",
    surface: "tool-calling",
    purpose: "Measures structured tool/function-call correctness under Kiln authority.",
    authorityProfile: "foundation-readonly-plan",
    requiredScorers: ["tool-calling-accuracy", "tool-trajectory", "latency", "cost", "execution-integrity"],
    minimumPassAtK: 0.9,
    minimumK: 5,
    reproducibilityRequirements: [
      "fixed provider/model or declared route policy",
      "versioned dataset",
      "config hash",
      "tool catalog snapshot",
      "result artifact URI",
    ],
    externalTrackCandidates: ["bfcl", "tau"],
  },
  {
    id: "kiln-managed-child-agent",
    version: "2",
    displayName: "Kiln Managed Child Agent",
    surface: "managed-child",
    purpose: "Measures governed child invocation, route selection, handoff quality, and evidence preservation.",
    authorityProfile: "foundation-readonly-plan",
    requiredScorers: ["routing-accuracy", "handoff-quality", "tool-trajectory", "latency", "cost", "execution-integrity"],
    minimumPassAtK: 0.85,
    minimumK: 5,
    reproducibilityRequirements: [
      "fixed managed invocation route catalog",
      "capability snapshot evidence",
      "versioned dataset",
      "config hash",
      "transcript and handoff artifact URIs",
    ],
    externalTrackCandidates: ["tau", "agentdojo"],
  },
  {
    id: "kiln-managed-frontend-team",
    version: "1",
    displayName: "Kiln Managed Frontend Team",
    surface: "managed-team",
    purpose: "Measures governed specialist composition, dependency handoffs, route diversity, and terminal frontend-team outcomes against individual-agent baselines.",
    authorityProfile: "foundation-readonly-plan",
    requiredScorers: ["routing-accuracy", "team-composition", "handoff-quality", "tool-trajectory", "latency", "cost", "execution-integrity"],
    minimumPassAtK: 0.85,
    minimumK: 5,
    reproducibilityRequirements: [
      "fixed managed agent and route catalogs",
      "versioned frontend team dataset",
      "config hash",
      "orchestration tool-call and terminal route evidence",
      "paired individual-agent baseline under the same fixture and authority",
    ],
    externalTrackCandidates: ["tau"],
  },
  {
    id: "kiln-managed-coding-agent",
    version: "2",
    displayName: "Kiln Managed Coding Agent",
    surface: "managed-coding",
    purpose: "Measures bounded coding work with approved authority, tests, rollback evidence, and replayable handoff.",
    authorityProfile: "foundation-apply-approved-writes",
    requiredScorers: ["milestone", "tool-trajectory", "handoff-quality", "latency", "cost", "execution-integrity"],
    minimumPassAtK: 0.8,
    minimumK: 5,
    reproducibilityRequirements: [
      "isolated fixture workspace",
      "approved write-authority scope",
      "versioned dataset",
      "config hash",
      "diff or artifact evidence URI",
    ],
    externalTrackCandidates: ["terminal-bench", "swe-bench"],
  },
  {
    id: "kiln-safety-agent",
    version: "2",
    displayName: "Kiln Safety Agent",
    surface: "safety",
    purpose: "Measures prompt-injection resistance, policy preservation, and utility under adversarial input.",
    authorityProfile: "foundation-readonly-plan",
    requiredScorers: ["safety-preservation", "policy-adherence", "tool-trajectory", "execution-integrity"],
    minimumPassAtK: 0.9,
    minimumK: 5,
    reproducibilityRequirements: [
      "versioned adversarial dataset",
      "policy snapshot",
      "config hash",
      "tool catalog snapshot",
      "result artifact URI",
    ],
    externalTrackCandidates: ["agentdojo"],
  },
] as const;

export const KILN_EXTERNAL_BENCHMARK_TRACKS: readonly BenchmarkTrack[] = [
  {
    id: "bfcl",
    displayName: "Berkeley Function Calling Leaderboard",
    purpose: "Tool/function-calling correctness.",
    status: "candidate",
    requiredProfileSurfaces: ["tool-calling"],
  },
  {
    id: "agentdojo",
    displayName: "AgentDojo",
    purpose: "Prompt-injection safety with utility preservation.",
    status: "candidate",
    requiredProfileSurfaces: ["safety", "managed-child"],
  },
  {
    id: "tau",
    displayName: "tau-bench style workflows",
    purpose: "Reliable tool-agent-user workflows measured with pass^k.",
    status: "candidate",
    requiredProfileSurfaces: ["tool-calling", "managed-child"],
  },
  {
    id: "terminal-bench",
    displayName: "Terminal-Bench",
    purpose: "Terminal autonomy for a frozen terminal-agent surface.",
    status: "blocked-until-profile",
    requiredProfileSurfaces: ["managed-coding"],
  },
  {
    id: "swe-bench",
    displayName: "SWE-bench",
    purpose: "Repository issue resolution for a coding-agent surface.",
    status: "blocked-until-profile",
    requiredProfileSurfaces: ["managed-coding"],
  },
  {
    id: "webarena",
    displayName: "WebArena",
    purpose: "Browser/web interaction tasks for a future browser surface.",
    status: "blocked-until-profile",
    requiredProfileSurfaces: [],
  },
  {
    id: "osworld",
    displayName: "OSWorld",
    purpose: "Desktop OS interaction tasks for a future OS-control surface.",
    status: "blocked-until-profile",
    requiredProfileSurfaces: [],
  },
] as const;

export function evaluateBenchmarkReadiness(input: BenchmarkReadinessInput): BenchmarkReadinessReport {
  const profiles = input.profiles ?? KILN_BENCHMARK_PROFILES;
  const tracks = input.tracks ?? KILN_EXTERNAL_BENCHMARK_TRACKS;
  const profileReadiness = profiles.map((profile) => evaluateProfileReadiness(profile, input.baselines));
  const profileStatus = new Map(profileReadiness.map((entry) => [entry.profileId, entry.status] as const));
  const surfaceReadiness = new Set(
    profiles
      .filter((profile) => profileStatus.get(profile.id) !== "blocked")
      .map((profile) => profile.surface),
  );

  const externalReadyTracks = tracks
    .filter((track) =>
      track.status === "candidate"
      && track.requiredProfileSurfaces.every((surface) => surfaceReadiness.has(surface))
    )
    .map((track) => track.id);
  const blockedTracks = tracks
    .filter((track) => !externalReadyTracks.includes(track.id))
    .map((track) => track.id);
  const issues = [
    ...profileReadiness.flatMap((entry) => entry.issues.map((issue) => `${entry.profileId}: ${issue}`)),
    ...tracks
      .filter((track) => track.status !== "candidate")
      .map((track) => `${track.id}: ${track.status}`),
  ];
  const anyBlockedProfile = profileReadiness.some((entry) => entry.status === "blocked");
  const status = externalReadyTracks.length > 0 && !anyBlockedProfile
    ? "external-ready"
    : anyBlockedProfile
      ? "blocked"
      : "internal-baseline-ready";

  return {
    status,
    profileReadiness,
    externalReadyTracks,
    blockedTracks,
    issues,
  };
}

function evaluateProfileReadiness(
  profile: BenchmarkProfile,
  baselines: readonly BenchmarkBaselineResult[],
): BenchmarkProfileReadiness {
  const baseline = baselines.find((entry) =>
    entry.profileId === profile.id
    && entry.profileVersion === profile.version
  );
  if (!baseline) {
    return {
      profileId: profile.id,
      status: "blocked",
      issues: [`missing baseline for profile version ${profile.version}`],
    };
  }

  const issues = [
    ...(baseline.k >= profile.minimumK ? [] : [`pass^k requires k >= ${profile.minimumK}`]),
    ...(baseline.passAtK >= profile.minimumPassAtK ? [] : [`passAtK ${baseline.passAtK} is below ${profile.minimumPassAtK}`]),
    ...missingScorers(profile, baseline).map((scorer) => `missing required scorer ${scorer}`),
    ...(baseline.artifactUris.length > 0 ? [] : ["missing result artifact URI"]),
    ...missingEvidenceArtifacts(baseline).map((kind) => `missing required evidence artifact ${kind}`),
    ...(baseline.configHash.trim().length > 0 ? [] : ["missing config hash"]),
    ...(baseline.datasetVersion.trim().length > 0 ? [] : ["missing dataset version"]),
  ];

  return {
    profileId: profile.id,
    status: issues.length === 0 ? "internal-baseline-ready" : "blocked",
    issues,
    baseline,
  };
}

function missingScorers(
  profile: BenchmarkProfile,
  baseline: BenchmarkBaselineResult,
): readonly string[] {
  const present = new Set(baseline.scorers);
  return profile.requiredScorers.filter((scorer) => !present.has(scorer));
}

function missingEvidenceArtifacts(baseline: BenchmarkBaselineResult): readonly BenchmarkEvidenceArtifactKind[] {
  const present = new Set(baseline.evidenceArtifacts.map((artifact) => artifact.kind));
  const required: readonly BenchmarkEvidenceArtifactKind[] = [
    "result",
    "transcript",
    "tool-calls",
    "diagnostics",
    "usage",
    "route",
    "cost",
    "cache-topology",
  ];
  return required.filter((kind) => !present.has(kind));
}
