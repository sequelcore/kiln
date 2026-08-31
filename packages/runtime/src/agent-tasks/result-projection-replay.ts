import type {
  AgentTaskDispatch,
  AgentTaskEconomicReplay,
  AgentTaskEconomicReplayPort,
  AgentTaskRecord,
  AgentTaskReplayQuery,
  AgentTaskResultAvailability,
  AgentTaskResultQuery,
} from "./contracts.js";
import { normalizeAgentTaskResultHandoff } from "./agent-run-validation.js";

export function projectAgentTaskResult(
  task: AgentTaskRecord,
  availability: AgentTaskResultAvailability,
  diagnostic = task.diagnostic,
): AgentTaskResultQuery {
  const result = task.result;
  return {
    jobId: task.id,
    availability,
    lifecycleState: task.state,
    configuredAgentProfileId: task.configuredAgentProfileId,
    admissionProfileId: task.admissionProfileId,
    ...(task.capability ? { capability: structuredClone(task.capability) } : {}),
    ...(result ? {
      routeId: result.routeId, providerId: result.providerId, completedAt: result.completedAt,
      provenance: { ...result.provenance }, handoff: normalizeAgentTaskResultHandoff(result.resultHandoff),
      ...(result.capabilityOutput ? { capabilityOutput: structuredClone(result.capabilityOutput) } : {}),
      ...(result.writeEvidence ? { writeEvidence: structuredClone(result.writeEvidence) } : {}),
      ...(result.dataPolicyProof ? { dataPolicyProof: structuredClone(result.dataPolicyProof) } : {}),
    } : task.dispatch.kind === "native-harness"
      ? { routeId: task.dispatch.routeId, providerId: task.dispatch.providerId }
      : {}),
    ...(task.writeApproval ? { writeApproval: task.writeApproval } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(task.failureEvidence ? { failureEvidence: task.failureEvidence } : {}),
  };
}

export function projectAgentTaskReplay(
  task: AgentTaskRecord,
  economicReplayPort?: AgentTaskEconomicReplayPort,
): AgentTaskReplayQuery {
  return {
    jobId: task.id,
    availability: "available",
    lifecycleState: task.state,
    configuredAgentProfileId: task.configuredAgentProfileId,
    admissionProfileId: task.admissionProfileId,
    ...(task.capability ? { capability: structuredClone(task.capability) } : {}),
    ...(task.result ? { routeId: task.result.routeId, providerId: task.result.providerId } : {}),
    lifecycle: task.lifecycle,
    resultAvailability: task.state === "succeeded" ? (task.result ? "available" : "unavailable")
      : task.state === "awaiting_approval" || task.state === "queued" || task.state === "running" ? "pending"
        : task.state === "interrupted" ? "unresolved" : "failed",
    ...(task.result?.capabilityOutput ? { capabilityOutput: structuredClone(task.result.capabilityOutput) } : {}),
    ...(task.result?.writeEvidence ? { writeEvidence: structuredClone(task.result.writeEvidence) } : {}),
    ...(task.result?.dataPolicyProof ? { dataPolicyProof: structuredClone(task.result.dataPolicyProof) } : {}),
    ...(task.writeApproval ? { writeApproval: task.writeApproval } : {}),
    dispatch: projectDispatch(task, economicReplayPort),
    ...(task.diagnostic ? { diagnostic: task.diagnostic } : {}),
    ...(task.failureEvidence ? { failureEvidence: task.failureEvidence } : {}),
  };
}

function projectDispatch(task: AgentTaskRecord, replayPort?: AgentTaskEconomicReplayPort): AgentTaskReplayQuery["dispatch"] {
  if (task.dispatch.kind === "native-harness") {
    return { ...task.dispatch };
  }
  return { kind: "economic", economic: inspectEconomicReplay(task, task.dispatch, replayPort) };
}

function inspectEconomicReplay(
  task: AgentTaskRecord,
  dispatch: Extract<AgentTaskDispatch, { readonly kind: "economic" }>,
  replayPort?: AgentTaskEconomicReplayPort,
): AgentTaskEconomicReplay {
  if (!replayPort) return { availability: "unavailable", reason: "authority-unavailable" };
  try {
    const snapshot = replayPort.inspect({ jobId: task.id, economicAttemptId: dispatch.economicAttemptId });
    return snapshot ? { availability: "available", snapshot } : { availability: "unavailable", reason: "evidence-not-found" };
  } catch {
    return { availability: "unavailable", reason: "evidence-unprojectable" };
  }
}
