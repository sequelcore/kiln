import { describe, expect, it } from "vitest";
import { formalVerificationToolMetadata, staticAnalysisToolMetadata } from "@kilnai/core/tools";
import type { ToolDefinition } from "@kilnai/core/agents";
import { gentleReviewObservation, STATIC_ANALYSIS_PROFILE } from "@kilnai/core/verification";
import type {
  CompletionObligation,
  RequiredProducerEvidence,
} from "@kilnai/core/agents";
import {
  assessRuntimeCompletionObligations,
  deriveRuntimeRequiredProducerEvidence,
} from "../../src/session/runtime-completion-obligations.js";
import type { ToolExecutionSummary } from "../../src/session/runtime-session-orchestrator.types.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function obligation(
  canonicalToolId: string,
  acceptedEquivalentToolIds: readonly string[] = [],
): CompletionObligation {
  return {
    kind: "required_producer",
    obligationId: `required-producer:${canonicalToolId}`,
    canonicalToolId,
    acceptedEquivalentToolIds,
    sourceAlias: canonicalToolId,
  };
}

function execution(
  toolName: string,
  overrides: Partial<ToolExecutionSummary> = {},
): ToolExecutionSummary {
  return {
    toolName,
    durationMs: 1,
    success: true,
    resultSummary: "completed",
    ...overrides,
  };
}

function formalMetadata(): Record<string, unknown> {
  return {
    ...formalVerificationToolMetadata({
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: DIGEST },
      subjects: [{ path: "src/Test.dfy", contentDigest: DIGEST }],
      checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
    }),
  };
}

function staticMetadata(): Record<string, unknown> {
  return {
    ...staticAnalysisToolMetadata({
      analyzer: { name: "oxlint", version: "1.0.0" },
      profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: 1 },
      outcome: "clean",
      subjects: [{ path: "src/Test.ts", contentDigest: DIGEST }],
      diagnostics: [],
    }),
  };
}

function gentleMetadata(): Record<string, unknown> {
  return {
    ...gentleReviewObservation({
      engine: {
        name: "gentle-ai",
        version: "1.0.0",
        releaseChannel: "stable",
        executableDigest: DIGEST,
      },
      candidate: {
        targetIdentity: DIGEST,
        projection: "workspace",
        baseTree: "a".repeat(40),
        candidateTree: "b".repeat(40),
        pathsDigest: DIGEST,
        paths: ["src/Test.ts"],
      },
      authority: {
        lineageId: "lineage-1",
        state: "active",
        generation: 1,
        revision: DIGEST,
      },
      outcome: {
        applicability: "applicable",
        action: "review",
        replayability: "replayable",
      },
    }),
  };
}

describe("Runtime required producer evidence", () => {
  it("returns unavailable when the exact canonical producer is absent", () => {
    const required = [obligation("formal_verify")];

    expect(deriveRuntimeRequiredProducerEvidence(
      required,
      new Set(["bash"]),
      [execution("bash", { output: "Dafny completed" })],
    )).toEqual<readonly RequiredProducerEvidence[]>([
      { canonicalProducerId: "formal_verify", status: "unavailable" },
    ]);
    expect(assessRuntimeCompletionObligations(required, new Set(["bash"]), [execution("bash")]).eligibility).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "formal_verify",
        status: "unavailable",
        evidence: { canonicalProducerId: "formal_verify", status: "unavailable" },
      }],
    });
  });

  it("keeps a Bash substitution not_run when the canonical producer is available", () => {
    const required = [obligation("formal_verify")];

    expect(deriveRuntimeRequiredProducerEvidence(
      required,
      new Set(["formal_verify", "bash"]),
      [execution("bash", { output: "Dafny completed" })],
    )).toEqual([{ canonicalProducerId: "formal_verify", status: "not_run" }]);
    expect(assessRuntimeCompletionObligations(required, new Set(["formal_verify", "bash"]), [execution("bash")]).eligibility).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "formal_verify",
        status: "not_run",
        evidence: { canonicalProducerId: "formal_verify", status: "not_run" },
      }],
    });
  });

  it("returns execution_failed for an exact failed producer invocation", () => {
    expect(deriveRuntimeRequiredProducerEvidence(
      [obligation("formal_verify")],
      new Set(["formal_verify"]),
      [execution("formal_verify", { success: false, output: "verifier failed" })],
    )).toEqual([{ canonicalProducerId: "formal_verify", status: "execution_failed" }]);
  });

  it("returns invalid_evidence for a successful invocation without valid typed metadata", () => {
    expect(deriveRuntimeRequiredProducerEvidence(
      [obligation("static_analyze")],
      new Set(["static_analyze"]),
      [execution("static_analyze", { metadata: { toolName: "static_analyze", kind: "static_analysis" } })],
    )).toEqual([{ canonicalProducerId: "static_analyze", status: "invalid_evidence" }]);
  });

  it("returns invalid_evidence when valid metadata lacks either scoped execution identity", () => {
    expect(deriveRuntimeRequiredProducerEvidence(
      [obligation("formal_verify")],
      new Set(["formal_verify"]),
      [execution("formal_verify", { toolCallId: "formal-1", metadata: formalMetadata() })],
    )).toEqual([{ canonicalProducerId: "formal_verify", status: "invalid_evidence" }]);

    expect(deriveRuntimeRequiredProducerEvidence(
      [obligation("formal_verify")],
      new Set(["formal_verify"]),
      [execution("formal_verify", { toolCallScopeId: "scope-1", metadata: formalMetadata() })],
    )).toEqual([{ canonicalProducerId: "formal_verify", status: "invalid_evidence" }]);
  });

  it("accepts all three canonical observation shapes and records tool call references", () => {
    const required = [
      obligation("gentle_review"),
      obligation("formal_verify"),
      obligation("static_analyze"),
    ];
    const available = new Set(required.map((item) => item.canonicalToolId));
    const executions = [
      execution("gentle_review", {
        toolCallScopeId: "scope-gentle",
        toolCallId: "gentle-1",
        metadata: gentleMetadata(),
      }),
      execution("formal_verify", {
        toolCallScopeId: "scope-formal",
        toolCallId: "formal-1",
        metadata: formalMetadata(),
      }),
      execution("static_analyze", {
        toolCallScopeId: "scope-static",
        toolCallId: "static-1",
        metadata: staticMetadata(),
      }),
    ];

    expect(deriveRuntimeRequiredProducerEvidence(required, available, executions)).toEqual([
      {
        canonicalProducerId: "gentle_review",
        status: "accepted",
        evidenceReferences: [{ toolCallScopeId: "scope-gentle", toolCallId: "gentle-1" }],
      },
      {
        canonicalProducerId: "formal_verify",
        status: "accepted",
        evidenceReferences: [{ toolCallScopeId: "scope-formal", toolCallId: "formal-1" }],
      },
      {
        canonicalProducerId: "static_analyze",
        status: "accepted",
        evidenceReferences: [{ toolCallScopeId: "scope-static", toolCallId: "static-1" }],
      },
    ]);
    expect(assessRuntimeCompletionObligations(required, available, executions).eligibility).toEqual({ status: "eligible" });
  });

  it("accepts an explicitly listed equivalent only by its exact ID", () => {
    const required = [obligation("formal_verify", ["formal_verify_proxy"])]
      .map((item) => ({ ...item, sourceAlias: "Dafny" }));

    expect(deriveRuntimeRequiredProducerEvidence(
      required,
      new Set(["formal_verify_proxy"]),
      [execution("formal_verify_proxy", {
        toolCallScopeId: "scope-proxy",
        toolCallId: "proxy-1",
        metadata: formalMetadata(),
      })],
    )).toEqual([{
      canonicalProducerId: "formal_verify_proxy",
      status: "accepted",
      evidenceReferences: [{ toolCallScopeId: "scope-proxy", toolCallId: "proxy-1" }],
    }]);
    expect(assessRuntimeCompletionObligations(required, new Set(["formal_verify_proxy"]), [
      execution("Dafny", { metadata: formalMetadata() }),
    ]).eligibility).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "Dafny",
        status: "not_run",
        evidence: { canonicalProducerId: "formal_verify", status: "not_run" },
      }],
    });
  });

  it("does not let a valid observation on another tool satisfy the obligation", () => {
    const tool: ToolDefinition = {
      name: "bash",
      description: "shell",
      inputSchema: {},
      tags: new Set(["command"]),
    };
    expect(assessRuntimeCompletionObligations(
      [obligation("gentle_review")],
      new Set([tool.name, "gentle_review"]),
      [execution(tool.name, { metadata: gentleMetadata() })],
    ).eligibility.status).toBe("ineligible");
  });
});
