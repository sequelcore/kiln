import type { GuiInboundFrame, GuiOutboundFrame } from "@kilnai/gateway-contracts";
import {
  OperatorTerminalError,
  type OperatorTerminalEvent,
  type OperatorTerminalService,
} from "./operator-terminal-service.js";

type TerminalOutboundFrame = Extract<GuiOutboundFrame, { type: `operator_terminal_${string}` }>;

export async function handleOperatorTerminalFrame(input: {
  readonly frame: GuiOutboundFrame | Record<string, unknown>;
  readonly authorized: boolean;
  readonly ownerId: string;
  readonly service: OperatorTerminalService;
  readonly send: (frame: GuiInboundFrame) => void;
}): Promise<boolean> {
  if (!isTerminalFrame(input.frame)) return false;
  const frame = input.frame;
  if (!input.authorized) {
    input.send({
      type: "operator_terminal_error",
      code: "terminal_unauthorized",
      message: "This GUI connection is not authorized to open an operator terminal.",
      ...frameIdentity(frame),
    });
    return true;
  }

  try {
    switch (frame.type) {
      case "operator_terminal_open": {
        const requestId = requiredString(frame.requestId, "requestId");
        const pendingEvents: OperatorTerminalEvent[] = [];
        let opened = false;
        const forwardEvent = (event: OperatorTerminalEvent): void => {
          if (!opened) {
            pendingEvents.push(event);
            return;
          }
          input.send(projectTerminalEvent(event));
        };
        const terminal = await input.service.open({
          ownerId: input.ownerId,
          cols: requiredInteger(frame.cols, "cols"),
          rows: requiredInteger(frame.rows, "rows"),
          ...(typeof frame.cwd === "string" && frame.cwd.trim() ? { cwd: frame.cwd } : {}),
          onEvent: forwardEvent,
        });
        input.send({ type: "operator_terminal_opened", requestId, ...terminal });
        opened = true;
        for (const event of pendingEvents) input.send(projectTerminalEvent(event));
        return true;
      }
      case "operator_terminal_write":
        input.service.write(
          input.ownerId,
          requiredString(frame.terminalId, "terminalId"),
          requiredString(frame.data, "data", true),
        );
        return true;
      case "operator_terminal_resize":
        input.service.resize(
          input.ownerId,
          requiredString(frame.terminalId, "terminalId"),
          requiredInteger(frame.cols, "cols"),
          requiredInteger(frame.rows, "rows"),
        );
        return true;
      case "operator_terminal_close":
        input.service.close(input.ownerId, requiredString(frame.terminalId, "terminalId"));
        return true;
    }
  } catch (error) {
    const terminalError = error instanceof OperatorTerminalError
      ? error
      : new OperatorTerminalError("terminal_unavailable", "Terminal request could not be completed.");
    input.send({
      type: "operator_terminal_error",
      code: terminalError.code,
      message: terminalError.message,
      ...frameIdentity(frame),
    });
    return true;
  }
}

function isTerminalFrame(frame: GuiOutboundFrame | Record<string, unknown>): frame is TerminalOutboundFrame {
  return frame.type === "operator_terminal_open"
    || frame.type === "operator_terminal_write"
    || frame.type === "operator_terminal_resize"
    || frame.type === "operator_terminal_close";
}

function projectTerminalEvent(event: OperatorTerminalEvent): GuiInboundFrame {
  return event.type === "output"
    ? { type: "operator_terminal_output", terminalId: event.terminalId, data: event.data }
    : {
        type: "operator_terminal_exited",
        terminalId: event.terminalId,
        exitCode: event.exitCode,
        ...(event.signal === undefined ? {} : { signal: event.signal }),
      };
}

function frameIdentity(frame: TerminalOutboundFrame): { requestId?: string; terminalId?: string } {
  return {
    ...(typeof (frame as { requestId?: unknown }).requestId === "string"
      ? { requestId: (frame as { requestId: string }).requestId }
      : {}),
    ...(typeof (frame as { terminalId?: unknown }).terminalId === "string"
      ? { terminalId: (frame as { terminalId: string }).terminalId }
      : {}),
  };
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new OperatorTerminalError("invalid_request", `Terminal ${field} is invalid.`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new OperatorTerminalError("invalid_dimensions", `Terminal ${field} must be an integer.`);
  }
  return value as number;
}
