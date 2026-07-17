import type { ManagedAgentInvocationRequest } from "@kilnai/core";

export function appendManagedResultHandoffContract(
  prompt: string,
  request: ManagedAgentInvocationRequest,
): string {
  const contract = request.input.handoff;
  if (!contract) return prompt;

  const evidenceUri = `kiln://managed-invocations/${encodeURIComponent(request.invocationId)}/transcript`;
  return [
    prompt,
    "",
    "## Managed Result Handoff Contract",
    "Your final response must be exactly one JSON object with no Markdown fence or surrounding prose.",
    "It must satisfy the structured-execution-result-v1 contract shown below.",
    `Role intent: ${contract.roleIntent ?? "managed child"}.`,
    `Required result fields: ${(contract.requiredResultFields ?? []).join(", ") || "summary"}.`,
    `Expected evidence: ${(contract.expectedEvidence ?? []).join(", ") || "result handoff"}.`,
    `Done criteria: ${(contract.doneCriteria ?? []).join("; ") || "Return a bounded, truthful result."}`,
    contract.residualRiskRequired === true
      ? "residualRisks must contain at least one concrete remaining limitation or risk."
      : "residualRisks may be empty only when no material risk remains.",
    "verificationResults must describe checks actually performed; never report a passed check that was not executed.",
    `Use ${evidenceUri} when the invocation transcript is the supporting evidence.`,
    "Required JSON shape:",
    JSON.stringify({
      version: "structured-execution-result-v1",
      status: "completed | blocked | failed | cancelled",
      summary: "bounded result summary",
      limitations: ["known limitation"],
      operatorDecisions: [{ id: "decision-id", summary: "decision needed", rationale: "why" }],
      evidence: [{ uri: evidenceUri, kind: "artifact | citation | diagnostic | verification", label: "evidence label" }],
      citations: [{ uri: evidenceUri, label: "citation label" }],
      warnings: ["warning"],
      failures: ["failure"],
      approvalRequirements: [{ id: "approval-id", status: "pending | approved | denied", summary: "approval requirement" }],
      residualRisks: ["remaining risk"],
      verificationResults: [{
        requirementId: "requirement-id",
        method: "deterministic | model-judge | human-review",
        status: "passed | failed | skipped | inconclusive",
        summary: "verification outcome",
        evidenceUris: [evidenceUri],
      }],
    }),
    "Use empty arrays for optional collections with no entries. A completed result cannot contain failures, pending approvals, or failed verification.",
  ].join("\n");
}
