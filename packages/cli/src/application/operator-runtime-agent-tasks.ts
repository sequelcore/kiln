import {
  OperatorRuntimeApplicationResponseSchema,
  type OperatorRuntimeApplicationRequest,
} from "@kilnai/gateway-contracts";
import { OPERATOR_RUNTIME_APPLICATION_PATH } from "@kilnai/runtime";
import type { OperatorRuntimeClientSession } from "./operator-runtime-client-session.js";

export interface OperatorRuntimeAgentTaskClient {
  submit(input: {
    readonly objective: string;
    readonly configuredAgentProfileId: string;
    readonly idempotencyKey: string;
  }): Promise<unknown>;
  status(jobId: string): Promise<unknown>;
  result(jobId: string): Promise<unknown>;
  cancel(jobId: string): Promise<unknown>;
  replay(jobId: string): Promise<unknown>;
}

/** Typed operator-surface client; MCP remains only a native-harness adapter. */
export function createOperatorRuntimeAgentTaskClient(
  session: OperatorRuntimeClientSession,
): OperatorRuntimeAgentTaskClient {
  const request = async (command: OperatorRuntimeApplicationRequest): Promise<unknown> => {
    const response = await session.request(OPERATOR_RUNTIME_APPLICATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`Operator Runtime rejected the Agent Task request (${response.status}).`);
    const parsed = OperatorRuntimeApplicationResponseSchema.parse(await response.json());
    if (parsed.status === "error") throw new Error(parsed.error.message);
    return parsed.result;
  };
  return {
    submit: (input) => request({ schemaVersion: 1, operation: "agent-task.submit", input }),
    status: (jobId) => request({ schemaVersion: 1, operation: "agent-task.status", jobId }),
    result: (jobId) => request({ schemaVersion: 1, operation: "agent-task.result", jobId }),
    cancel: (jobId) => request({ schemaVersion: 1, operation: "agent-task.cancel", jobId }),
    replay: (jobId) => request({ schemaVersion: 1, operation: "agent-task.replay", jobId }),
  };
}
