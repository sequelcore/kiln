import {
  GENTLE_REVIEW_CAPABILITIES_SCHEMA,
  GENTLE_REVIEW_CONTRACT,
  GENTLE_REVIEW_STATUS_SCHEMA,
  type GentleReviewObservation,
  gentleReviewObservation,
} from "../../../../verification/inferential/gentle-review-observation.js";
import type { CommandProcessResult, CommandProcessRunner } from "../../command-process.js";

const MAX_OUTPUT_CHARACTERS = 2_000_000;
const MANDATORY_FEATURES = new Set([
  "compact_v2_authority",
  "exact_receipt_replay",
  "five_delivery_gates",
  "immutable_snapshot",
  "legacy_v1_target_scoped_read_only",
  "repository_independent_capabilities",
  "restart_safe_projection",
  "sdd_receipt_binding",
  "target_scoped_status",
  "uniform_failure_envelope",
]);
const REQUIRED_OPTIONAL_FEATURES = new Set([
  "native_next_transition",
  "native_frozen_candidate_context",
  "opaque_repository_context",
  "provider_artifact_admission",
  "provider_bound_native_git_context",
  "provider_submission_descriptors",
]);

export interface GentleAiClientOptions {
  readonly executable: string;
  readonly cwd: string;
  readonly capabilitiesCwd: string;
  readonly expectedVersion: string;
  readonly expectedExecutableDigest: string;
  readonly expectedBuildRevision: string;
  readonly timeoutMs?: number;
}

export interface GentleAiStatusRequest {
  readonly baseTree: string;
  readonly expectedTargetIdentity: string;
  readonly signal?: AbortSignal;
}

export class GentleAiClient {
  constructor(
    private readonly runner: CommandProcessRunner,
    private readonly options: GentleAiClientOptions,
  ) {}

  async observe(request: GentleAiStatusRequest): Promise<GentleReviewObservation> {
    const capabilities = parseCapabilities(
      await this.run(
        ["review", "capabilities", "--contract", GENTLE_REVIEW_CONTRACT],
        request.signal,
        this.options.capabilitiesCwd,
      ),
    );
    if (
      capabilities.version !== this.options.expectedVersion ||
      capabilities.executableDigest !== this.options.expectedExecutableDigest ||
      capabilities.buildRevision !== this.options.expectedBuildRevision
    ) {
      throw new Error("Gentle AI executable identity drifted from configured version, digest, or build revision");
    }
    const status = parseStatus(
      await this.run(
        [
          "review",
          "status",
          "--cwd",
          this.options.cwd,
          "--contract",
          GENTLE_REVIEW_CONTRACT,
          "--next-transition",
          "--workspace-overlay",
          "--base-tree",
          request.baseTree,
        ],
        request.signal,
      ),
    );
    if (status.applicability !== "current_target")
      throw new Error(`Gentle AI status is ${status.applicability}; candidate lineage is not uniquely applicable`);
    if (status.targetIdentity !== request.expectedTargetIdentity)
      throw new Error("Gentle AI target identity does not match the requested candidate");
    if (status.baseTree !== request.baseTree)
      throw new Error("Gentle AI status base tree does not match the requested candidate base");
    return gentleReviewObservation({
      engine: {
        name: "gentle-ai",
        version: capabilities.version,
        executableDigest: capabilities.executableDigest,
        buildRevision: capabilities.buildRevision,
      },
      candidate: {
        targetIdentity: status.targetIdentity,
        projection: "workspace",
        baseTree: status.baseTree,
        candidateTree: status.candidateTree,
        pathsDigest: status.pathsDigest,
        paths: status.paths,
      },
      authority: status.authority,
      receipt: status.receipt,
      outcome: {
        applicability: status.applicability,
        action: status.action,
        replayability: status.replayability,
        ...(status.nextTransition === undefined ? {} : { nextTransition: status.nextTransition }),
      },
    });
  }

  private run(args: readonly string[], signal?: AbortSignal, cwd = this.options.cwd): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let overflow = false;
      this.runner.start(
        {
          executable: this.options.executable,
          args,
          cwd,
          timeoutMs: this.options.timeoutMs,
          ...(signal === undefined ? {} : { signal }),
        },
        {
          output: (chunk) => {
            const next =
              chunk.stream === "stdout" ? stdout.length + chunk.text.length : stderr.length + chunk.text.length;
            if (next > MAX_OUTPUT_CHARACTERS) {
              overflow = true;
              return;
            }
            if (chunk.stream === "stdout") stdout += chunk.text;
            else stderr += chunk.text;
          },
          finish: (result) => {
            if (overflow) return reject(new Error("Gentle AI output exceeded the bounded result size"));
            const terminal = terminalFailure(result);
            if (terminal !== undefined)
              return reject(new Error(`Gentle AI ${terminal}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
            try {
              const parsed = JSON.parse(stdout) as unknown;
              if (
                result.exitCode !== 0 &&
                isRecord(parsed) &&
                parsed.schema === "gentle-ai.review-integration.failure/v2"
              ) {
                return reject(new Error(formatFailure(parsed)));
              }
              if (result.exitCode !== 0)
                return reject(new Error(`Gentle AI exited with code ${String(result.exitCode)}`));
              resolve(parsed);
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
        },
      );
    });
  }
}

function parseCapabilities(value: unknown): { version: string; executableDigest: string; buildRevision: string } {
  if (
    !isRecord(value) ||
    value.schema !== GENTLE_REVIEW_CAPABILITIES_SCHEMA ||
    value.contract !== GENTLE_REVIEW_CONTRACT ||
    !isRecord(value.protocol) ||
    value.protocol.major !== 2 ||
    value.protocol.minor !== 2
  )
    throw new Error("Gentle AI capabilities contract is incompatible");
  if (
    !isRecord(value.package) ||
    value.package.name !== "gentle-ai" ||
    !isVersion(value.package.version) ||
    value.package.release_channel !== "stable" ||
    !isRecord(value.executable) ||
    !isDigest(value.executable.sha256) ||
    value.executable.evidence !== "self-reported" ||
    value.executable.verification !== "compare-with-published-manifest" ||
    !isRecord(value.build) ||
    !isRevision(value.build.vcs_revision) ||
    value.build.vcs_modified !== "false"
  )
    throw new Error("Gentle AI capabilities executable identity is malformed");
  if (
    !Array.isArray(value.operations) ||
    !value.operations.includes("review.capabilities") ||
    !value.operations.includes("review.status") ||
    !Array.isArray(value.schemas) ||
    !value.schemas.includes(GENTLE_REVIEW_STATUS_SCHEMA) ||
    !value.schemas.includes("gentle-ai.review-integration.failure/v2")
  )
    throw new Error("Gentle AI capabilities omit required operations or schemas");
  if (!isRecord(value.features) || !Array.isArray(value.features.mandatory) || !Array.isArray(value.features.optional))
    throw new Error("Gentle AI capabilities feature set is malformed");
  const mandatoryFeatures = parseFeatureSet(value.features.mandatory, "mandatory");
  const optionalFeatures = parseFeatureSet(value.features.optional, "optional");
  const unknownMandatory = mandatoryFeatures.find(({ name }) => !MANDATORY_FEATURES.has(name));
  if (unknownMandatory !== undefined)
    throw new Error(`Gentle AI advertised unknown mandatory feature '${unknownMandatory.name}'`);
  const supported = new Set(
    [...mandatoryFeatures, ...optionalFeatures]
      .filter(({ supported: isSupported }) => isSupported)
      .map(({ name }) => name),
  );
  for (const feature of [...MANDATORY_FEATURES, ...REQUIRED_OPTIONAL_FEATURES])
    if (!supported.has(feature)) throw new Error(`Gentle AI required feature '${feature}' is unavailable`);
  return {
    version: value.package.version,
    executableDigest: value.executable.sha256,
    buildRevision: value.build.vcs_revision,
  };
}

function parseFeatureSet(
  value: readonly unknown[],
  kind: "mandatory" | "optional",
): readonly { readonly name: string; readonly supported: boolean }[] {
  const parsed = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      typeof entry.supported !== "boolean"
    ) {
      throw new Error(`Gentle AI ${kind} feature set is malformed`);
    }
    return { name: entry.name, supported: entry.supported };
  });
  if (new Set(parsed.map(({ name }) => name)).size !== parsed.length) {
    throw new Error(`Gentle AI ${kind} feature set contains duplicate names`);
  }
  return parsed;
}

function parseStatus(value: unknown): {
  applicability: string;
  targetIdentity: string;
  baseTree: string;
  candidateTree: string;
  pathsDigest: string;
  paths: readonly string[];
  authority: NonNullable<GentleReviewObservation["authority"]>;
  receipt: GentleReviewObservation["receipt"];
  action: string;
  replayability: string;
  nextTransition?: NonNullable<GentleReviewObservation["outcome"]["nextTransition"]>;
} {
  if (
    !isRecord(value) ||
    value.schema !== GENTLE_REVIEW_STATUS_SCHEMA ||
    value.contract !== GENTLE_REVIEW_CONTRACT ||
    value.operation !== "review.status"
  )
    throw new Error("Gentle AI status contract is incompatible");
  if (
    !isOneOf(value.applicability, ["current_target", "unrelated", "ambiguous", "corrupted"]) ||
    !isOneOf(value.action, [
      "start",
      "finalize",
      "validate",
      "recover",
      "retry_final_verification",
      "maintainer_action",
      "select_lineage",
      "repair_authority",
      "reconcile_finalize",
      "stop",
    ]) ||
    !isOneOf(value.replayability, [
      "not_replayable",
      "exact_replay_safe",
      "status_required",
      "manual_action_required",
    ]) ||
    !isDigest(value.target_identity)
  )
    throw new Error("Gentle AI status identity or outcome is malformed");
  if (
    !isRecord(value.projection) ||
    value.projection.projection !== "workspace" ||
    !isTree(value.projection.base_tree) ||
    !isTree(value.projection.current_candidate_tree) ||
    !isDigest(value.projection.paths_digest) ||
    !Array.isArray(value.projection.paths) ||
    value.projection.paths.length > 1000 ||
    value.projection.paths.some((path) => !isPortablePath(path))
  )
    throw new Error("Gentle AI status projection is malformed");
  if (
    !isRecord(value.authority) ||
    typeof value.authority.lineage_id !== "string" ||
    typeof value.authority.state !== "string" ||
    !isPositiveInteger(value.authority.generation) ||
    !isDigest(value.authority.revision)
  )
    throw new Error("Gentle AI status authority is malformed");
  if (
    !isRecord(value.receipt) ||
    !isOneOf(value.receipt.status, ["expected_missing", "present", "publication_pending", "not_applicable"]) ||
    (value.receipt.identity !== undefined && !isDigest(value.receipt.identity)) ||
    (value.receipt.status === "present") !== (value.receipt.identity !== undefined)
  )
    throw new Error("Gentle AI status receipt is malformed or stale");
  if (
    value.projection.current_snapshot_identity !== undefined &&
    value.projection.current_snapshot_identity !== value.target_identity
  )
    throw new Error("Gentle AI status snapshot identity is stale for the target");
  let nextTransition: NonNullable<GentleReviewObservation["outcome"]["nextTransition"]> | undefined;
  if (value.next_transition !== undefined) {
    if (
      !isRecord(value.next_transition) ||
      (value.next_transition.kind !== "execute" &&
        value.next_transition.kind !== "collect" &&
        value.next_transition.kind !== "stop") ||
      typeof value.next_transition.reason_code !== "string" ||
      !/^[a-z0-9_]+$/u.test(value.next_transition.reason_code)
    )
      throw new Error("Gentle AI next transition is malformed");
    nextTransition = { kind: value.next_transition.kind, reasonCode: value.next_transition.reason_code };
  }
  return {
    applicability: value.applicability,
    targetIdentity: value.target_identity,
    baseTree: value.projection.base_tree,
    candidateTree: value.projection.current_candidate_tree,
    pathsDigest: value.projection.paths_digest,
    paths: [...value.projection.paths] as string[],
    authority: {
      lineageId: value.authority.lineage_id,
      state: value.authority.state,
      generation: value.authority.generation,
      revision: value.authority.revision,
    },
    receipt: {
      status: value.receipt.status,
      ...(value.receipt.identity === undefined ? {} : { identity: value.receipt.identity }),
    },
    action: value.action,
    replayability: value.replayability,
    ...(nextTransition === undefined ? {} : { nextTransition }),
  };
}

function terminalFailure(result: CommandProcessResult): string | undefined {
  if (result.cancelled) return "was cancelled";
  if (result.timedOut) return "timed out";
  if (result.error) return `failed to run: ${result.error.message}`;
  if (result.signal !== undefined) return `terminated by ${String(result.signal)}`;
  return undefined;
}
function formatFailure(value: Record<string, unknown>): string {
  const mutation = String(value.mutation_outcome ?? "unknown");
  const replay = String(value.replayability ?? "unknown");
  return `Gentle AI ${String(value.operation)} failed (${String(value.code)}): ${String(value.message)}; mutation_outcome=${mutation}; replayability=${replay}`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
function isTree(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/u.test(value);
}
function isRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value);
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isPortablePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}
function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}
