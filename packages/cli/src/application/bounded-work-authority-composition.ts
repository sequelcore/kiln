import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assessBoundedWorkScope,
  createBoundedWorkCandidateEvidence,
  decideBoundedWorkCloseout,
  evaluateBoundedWorkAssurance,
  type BoundedWorkEffect,
} from "@kilnai/core";
import type {
  BoundedWorkAssuranceEvaluation,
  BoundedWorkCapabilityObservation,
} from "@kilnai/core/work-governance";
import { MANAGED_ORCHESTRATION_REVIEW_GATE } from "@kilnai/core/work-governance";
import { FORMAL_VERIFICATION_FINISH_TRANSPORT } from "@kilnai/core/tools";
import {
  captureGitWorktreeCandidate,
  resolveCandidateSubjectDigests,
  readRuntimeFormalVerificationFinishTransport,
  SqliteBoundedWorkAuthority,
  type AttachedRuntimeBuiltinToolSurfaceOptions,
} from "@kilnai/runtime";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";
import type {
  BoundedWorkCandidateCloseout,
  BoundedWorkExecutionAttemptAdmission,
  BoundedWorkGoalCloseout,
} from "./work-governance-tool.js";

export type ProjectBoundedWorkSurface = NonNullable<AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"]>;

export interface ProjectBoundedWorkAuthorityComposition {
  readonly surface: ProjectBoundedWorkSurface;
  readonly admitExecutionAttempt: BoundedWorkExecutionAttemptAdmission;
  readonly closeoutCandidate: BoundedWorkCandidateCloseout;
  readonly closeoutGoal: BoundedWorkGoalCloseout;
  close(): void;
}

export function createProjectBoundedWorkAuthority(
  cwd: string,
  options: {
    readonly authorityStateRoot?: string;
    readonly projectIdentityRoot?: string;
    /** Test/embedding seam for the verified operator-private project state. */
    readonly projectStateBinding?: ProjectStateBinding;
    readonly formalVerificationCapability?: BoundedWorkCapabilityObservation;
  } = {},
): ProjectBoundedWorkAuthorityComposition {
  // Benchmark callers provide an explicit disposable authority root. Production
  // callers resolve the verified project root once and use its private Runtime
  // namespace; no repository-local `.kiln` path is ever synthesized here.
  const binding = options.projectStateBinding
    ?? (options.authorityStateRoot === undefined ? resolveProjectStateBinding(cwd) : undefined);
  const projectRoot = binding?.canonicalRoot ?? resolve(cwd);
  const authorityStateRoot = resolve(options.authorityStateRoot ?? binding?.runtimePath ?? projectRoot);
  const projectIdentityRoot = resolve(options.projectIdentityRoot ?? binding?.canonicalRoot ?? projectRoot);
  const runtimeDirectory = authorityStateRoot;
  if (binding !== undefined && authorityStateRoot === resolve(binding.runtimePath)) {
    ensurePrivateStateDirectorySync(binding.projectStateRoot, runtimeDirectory);
    assertPrivateStateFileTargetSync(binding.projectStateRoot, join(runtimeDirectory, "bounded-work-authority.sqlite"));
  }
  mkdirSync(runtimeDirectory, { recursive: true });
  const authority = new SqliteBoundedWorkAuthority({
    path: join(runtimeDirectory, "bounded-work-authority.sqlite"),
    formalVerificationCapability: options.formalVerificationCapability ?? {
      metric: "formal_verification",
      status: "unavailable",
    },
  });
  const projectRuntimeId = `project:${createHash("sha256").update(projectIdentityRoot).digest("hex").slice(0, 32)}`;
  const composition: ProjectBoundedWorkAuthorityComposition = {
    surface: { projectRuntimeId, authority },
    admitExecutionAttempt({ goal, workItem, attemptId }) {
      const admission = authority.reserve({
        projectRuntimeId,
        goalRunId: goal.id,
        workItemId: workItem.id,
        contractRevision: goal.boundedWorkContractRevision,
        idempotencyKey: `attempt:${attemptId}`,
        route: { routeId: "kiln-goal-execution", harnessId: "kiln-runtime" },
        harnessCapability: "authoritative",
        reservation: { kind: "execution_attempt", amount: 1 },
      });
      if (admission.decision.kind !== "admitted") {
        return {
          admitted: false,
          code: admission.decision.kind,
          message: boundedWorkAttemptDecisionMessage(admission.decision),
        };
      }
      const receipt = admission.reservation!;
      return {
        admitted: true,
        commit: () => {
          let dispatched;
          try {
            dispatched = authority.markDispatched({
              reservationId: receipt.reservationId,
              expectedReservationRevision: receipt.revision,
              dispatchId: attemptId,
            });
            authority.settleTerminal({
              reservationId: dispatched.reservationId,
              expectedReservationRevision: dispatched.revision,
              terminalEvidenceDigest: digest({
                kind: "execution_attempt_started",
                goalRunId: goal.id,
                workItemId: workItem.id,
                attemptId,
                contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
              }),
              terminalOutcome: "completed",
            });
          } catch (error) {
            if (dispatched) {
              authority.settleUnknown({
                reservationId: dispatched.reservationId,
                expectedReservationRevision: dispatched.revision,
                reason: `Core attempt transition could not be reconciled: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
            throw error;
          }
        },
        release: () => {
          authority.releaseBeforeDispatch({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
          });
        },
      };
    },
    async closeoutCandidate(input) {
      const formalVerificationFinishTransport = input[FORMAL_VERIFICATION_FINISH_TRANSPORT];
      if (
        formalVerificationFinishTransport !== undefined
        && readRuntimeFormalVerificationFinishTransport() !== formalVerificationFinishTransport
      ) {
        return {
          captured: false,
          code: "formal_verification_transport_untrusted",
          message: "Formal verification transport must come from the registered Runtime finish path.",
        };
      }
      const {
        goal,
        workItem,
        attempt,
        verificationGateResults,
      } = input;
      const hasStructuredReview = verificationGateResults.some((result) =>
        result.gate === MANAGED_ORCHESTRATION_REVIEW_GATE && result.status === "passed"
      );
      const previousCandidate = [...workItem.executionAttempts]
        .reverse()
        .find((entry) => entry.id !== attempt.id && entry.candidate)?.candidate;
      const candidateCaptureRoot = attempt.candidateCaptureRoot ?? projectRoot;
      const captured = await captureGitWorktreeCandidate({
        worktreePath: candidateCaptureRoot,
        goalRunId: goal.id,
        workItemId: workItem.id,
        contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
        accountingLineageId: goal.id,
        ...(previousCandidate ? { previousCandidate } : {}),
        createdAt: new Date().toISOString(),
      });
      if (captured.status !== "captured") {
        return {
          captured: false,
          code: captured.reason,
          message: `Exact candidate capture requires reconciliation: ${captured.reason}.`,
        };
      }
      if (
        goal.boundedWorkContractRevision.contract.tripwires.changedLines !== undefined
        && captured.snapshot.changedLines.kind === "unavailable"
      ) {
        return {
          captured: false,
          code: "candidate_change_size_unavailable",
          message: "The candidate contains binary changes, so the configured changed-line tripwire cannot be evaluated.",
        };
      }
      const pathsByEffect = new Map<BoundedWorkEffect, string[]>();
      for (const path of captured.snapshot.changedPaths) {
        const effect = boundedWorkEffectForPath(path);
        pathsByEffect.set(effect, [...(pathsByEffect.get(effect) ?? []), path]);
      }
      const assessments = [...pathsByEffect].map(([effect, paths]) => assessBoundedWorkScope({
        revision: goal.boundedWorkContractRevision,
        workItemId: workItem.id,
        effect,
        surface: workItem.surface ?? goal.boundedWorkContractRevision.contract.scope.permittedSurfaces[0]!,
        paths,
        changedFiles: captured.snapshot.changedFiles,
        ...(captured.snapshot.changedLines.kind === "observed"
          ? { changedLines: captured.snapshot.changedLines.value }
          : {}),
      }));
      const scopeViolation = assessments.find((entry) => entry.status === "scope_revision_required");
      if (scopeViolation?.status === "scope_revision_required") {
        return {
          captured: false,
          code: "pause_scope_revision_required",
          message: `Candidate is outside bounded scope: ${scopeViolation.violations.map((entry) => entry.kind).join(", ")}.`,
        };
      }
      const tripwireTriggered = assessments.some((entry) => entry.diagnostics.length > 0);
      if (tripwireTriggered && !hasStructuredReview) {
        return {
          captured: false,
          code: "candidate_tripwire_review_required",
          message: "Candidate size crossed a configured tripwire and requires review evidence.",
        };
      }
      const evidence = formalVerificationFinishTransport?.observations.map((observation) => createBoundedWorkCandidateEvidence({
        candidate: captured.candidate,
        executionAttempt: {
          goalRunId: attempt.goalRunId,
          workItemId: attempt.workItemId,
          attemptId: attempt.id,
          ...(Object.prototype.hasOwnProperty.call(attempt, "managedInvocationId")
            ? { managedInvocationId: attempt.managedInvocationId }
            : {}),
        },
        invocation: {
          toolCallScopeId: observation.toolCallScopeId,
          toolCallId: observation.toolCallId,
        },
        attestation: {
          producer: formalVerificationFinishTransport.producer,
          payload: observation.metadata,
        },
        recordedAt: formalVerificationFinishTransport.recordedAt,
      })) ?? [];
      let assuranceEvaluation: BoundedWorkAssuranceEvaluation;
      try {
        const candidateSubjects = await resolveCandidateSubjectDigests({
          worktreePath: candidateCaptureRoot,
          candidate: captured.candidate,
          candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
        });
        assuranceEvaluation = evaluateBoundedWorkAssurance({
          revision: goal.boundedWorkContractRevision,
          candidate: captured.candidate,
          candidateSubjects,
          candidateEvidence: evidence,
          evaluatedAt: new Date().toISOString(),
        });
      } catch (error) {
        return {
          captured: false,
          code: "candidate_assurance_evaluation_failed",
          message: `Candidate Assurance evaluation requires reconciliation: ${error instanceof Error ? error.message : String(error)}.`,
        };
      }
      if (hasStructuredReview) {
        const review = authority.reserve({
          projectRuntimeId,
          goalRunId: goal.id,
          workItemId: workItem.id,
          contractRevision: goal.boundedWorkContractRevision,
          idempotencyKey: `review:${captured.candidate.candidateDigest}`,
          route: { routeId: "kiln-candidate-closeout", harnessId: "kiln-runtime" },
          harnessCapability: "authoritative",
          reservation: { kind: "review_round", amount: 1, candidateDigest: captured.candidate.candidateDigest },
        });
        if (review.decision.kind !== "admitted") {
          return { captured: false, code: review.decision.kind, message: boundedWorkAttemptDecisionMessage(review.decision) };
        }
      }
      if (previousCandidate) {
        const remediation = authority.reserve({
          projectRuntimeId,
          goalRunId: goal.id,
          workItemId: workItem.id,
          contractRevision: goal.boundedWorkContractRevision,
          idempotencyKey: `remediation:${captured.candidate.candidateDigest}`,
          route: { routeId: "kiln-candidate-closeout", harnessId: "kiln-runtime" },
          harnessCapability: "authoritative",
          reservation: {
            kind: "remediation_round",
            amount: 1,
            candidateDigest: captured.candidate.candidateDigest,
            previousCandidateDigest: previousCandidate.candidateDigest,
          },
        });
        if (remediation.decision.kind !== "admitted") {
          return { captured: false, code: remediation.decision.kind, message: boundedWorkAttemptDecisionMessage(remediation.decision) };
        }
      }
      return { captured: true, candidate: captured.candidate, evidence, assuranceEvaluation };
    },
    async closeoutGoal({ goal, candidate, candidateCaptureRoot, candidateEvidence, assuranceEvaluation }) {
      const current = await captureGitWorktreeCandidate({
        worktreePath: candidateCaptureRoot ?? projectRoot,
        goalRunId: goal.id,
        workItemId: candidate.workItemId,
        contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
        accountingLineageId: goal.id,
        createdAt: new Date().toISOString(),
      });
      if (current.status !== "captured") {
        throw new Error(`Goal closeout candidate reconciliation is required: ${current.reason}.`);
      }
      if (current.candidate.candidateContentDigest !== candidate.candidateContentDigest) {
        throw new Error("Goal closeout candidate is stale; capture and verify the current workspace before acceptance.");
      }
      const snapshot = authority.inspect({ projectRuntimeId, accountingLineageId: goal.id });
      if (!snapshot) throw new Error("Bounded-work accounting is unavailable for goal closeout.");
      return decideBoundedWorkCloseout({
        revision: goal.boundedWorkContractRevision,
        snapshot,
        candidateDigest: candidate.candidateDigest,
        candidateEvidence,
        assuranceEvaluation,
        decidedAt: new Date().toISOString(),
      });
    },
    close: () => authority.close(),
  };
  return composition;
}

function boundedWorkEffectForPath(path: string): BoundedWorkEffect {
  const normalized = path.replace(/\\/gu, "/").toLowerCase();
  if (normalized.includes("/test") || /\.(test|spec)\.[^/]+$/u.test(normalized)) return "modify_tests";
  if (normalized.startsWith("docs/") || /\.(md|mdx|rst)$/u.test(normalized)) return "modify_documentation";
  if (/(^|\/)(package\.json|bun\.lock|tsconfig[^/]*\.json|[^/]+\.ya?ml)$/u.test(normalized)) return "modify_configuration";
  return "modify_source";
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function boundedWorkAttemptDecisionMessage(
  decision: Exclude<ReturnType<SqliteBoundedWorkAuthority["reserve"]>["decision"], { readonly kind: "admitted" }>,
): string {
  switch (decision.kind) {
    case "pause_scope_revision_required":
      return `Execution attempt requires a bounded-work scope revision: ${decision.violations.map((entry) => entry.kind).join(", ")}.`;
    case "pause_budget_exhausted":
    case "stop_budget_exhausted":
      return `Execution-attempt limits are exhausted: ${decision.exhaustedLimits.join(", ")}.`;
    case "pause_capability_unavailable":
      return `Execution attempt lacks bounded-work authority: ${decision.unavailableMetrics.join(", ")}.`;
  }
}
