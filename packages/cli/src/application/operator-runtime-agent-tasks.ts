import {
  OperatorRuntimeApplicationResponseSchema,
  type OperatorRuntimeApplicationResponse,
  type OperatorRuntimeApplicationRequest,
} from "@kilnai/gateway-contracts";
import { OPERATOR_RUNTIME_APPLICATION_PATH } from "@kilnai/runtime";
import type { OperatorRuntimeClientSession } from "./operator-runtime-client-session.js";

const MAX_TRANSIENT_SUBMIT_RETRIES = 5;
const DEFAULT_SUBMIT_RETRY_DELAYS_MS = [250, 1_000, 3_000, 7_000, 20_000] as const;
const TRANSIENT_SUBMIT_ERROR_MESSAGE = "Agent Task application rejected the operation (unavailable).";

type OperatorRuntimeApplicationErrorCode = Extract<
  OperatorRuntimeApplicationResponse,
  { readonly status: "error" }
>["error"]["code"];

class OperatorRuntimeApplicationError extends Error {
  readonly name = "OperatorRuntimeApplicationError";

  constructor(readonly code: OperatorRuntimeApplicationErrorCode, message: string) {
    super(message);
  }
}

export interface OperatorRuntimeAgentTaskClientOptions {
  /** Test seam and bounded startup backoff for transient submit retries. */
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly retryDelaysMs?: readonly number[];
}

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
  options: OperatorRuntimeAgentTaskClientOptions = {},
): OperatorRuntimeAgentTaskClient {
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_SUBMIT_RETRY_DELAYS_MS;
  if (
    retryDelaysMs.length > MAX_TRANSIENT_SUBMIT_RETRIES
    || retryDelaysMs.some((delayMs) => !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000)
  ) {
    throw new Error("Agent Task submit retry delays must contain at most five values between 0 and 60000 milliseconds.");
  }
  const request = async (command: OperatorRuntimeApplicationRequest): Promise<unknown> => {
    const response = await session.request(OPERATOR_RUNTIME_APPLICATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`Operator Runtime rejected the Agent Task request (${response.status}).`);
    const parsed = OperatorRuntimeApplicationResponseSchema.parse(await response.json());
    if (parsed.status === "error") throw new OperatorRuntimeApplicationError(parsed.error.code, parsed.error.message);
    return parsed.result;
  };
  const submit = async (input: Parameters<OperatorRuntimeAgentTaskClient["submit"]>[0]): Promise<unknown> => {
    const command: OperatorRuntimeApplicationRequest = { schemaVersion: 1, operation: "agent-task.submit", input };
    for (let retry = 0; ; retry += 1) {
      try {
        return await request(command);
      } catch (error) {
        const retryDelayMs = retryDelaysMs[retry];
        if (retryDelayMs === undefined || !isTransientSubmitUnavailable(error)) throw error;
        await wait(retryDelayMs);
      }
    }
  };
  return {
    submit,
    status: (jobId) => request({ schemaVersion: 1, operation: "agent-task.status", jobId }),
    result: (jobId) => request({ schemaVersion: 1, operation: "agent-task.result", jobId }),
    cancel: (jobId) => request({ schemaVersion: 1, operation: "agent-task.cancel", jobId }),
    replay: (jobId) => request({ schemaVersion: 1, operation: "agent-task.replay", jobId }),
  };
}

function isTransientSubmitUnavailable(error: unknown): boolean {
  return error instanceof OperatorRuntimeApplicationError
    && error.code === "authority_rejected"
    && error.message === TRANSIENT_SUBMIT_ERROR_MESSAGE;
}
