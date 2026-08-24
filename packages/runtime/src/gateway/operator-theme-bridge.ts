import type {
  OperatorThemeSetFrame,
  OperatorThemeSetResultFrame,
} from "@kilnai/gateway-contracts";

export interface OperatorThemeRequest {
  readonly theme: string;
  readonly reason?: string;
}

export interface OperatorThemeResult {
  readonly ok: boolean;
  readonly appliedTheme?: string;
  readonly error?: string;
}

export interface OperatorThemeBridge {
  readonly request: (input: OperatorThemeRequest) => Promise<OperatorThemeResult>;
  readonly resolve: (frame: OperatorThemeSetResultFrame) => boolean;
  readonly rejectAll: (error: string) => void;
}

interface PendingOperatorThemeRequest {
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (result: OperatorThemeResult) => void;
}

const DEFAULT_OPERATOR_THEME_TIMEOUT_MS = 5_000;

export function createOperatorThemeBridge(
  sendFrame: (frame: OperatorThemeSetFrame) => void,
  timeoutMs = DEFAULT_OPERATOR_THEME_TIMEOUT_MS,
): OperatorThemeBridge {
  const pending = new Map<string, PendingOperatorThemeRequest>();
  let ordinal = 0;

  const resolvePending = (requestId: string, result: OperatorThemeResult): boolean => {
    const request = pending.get(requestId);
    if (!request) {
      return false;
    }
    pending.delete(requestId);
    clearTimeout(request.timeout);
    request.resolve(result);
    return true;
  };

  return {
    request: (input) => new Promise<OperatorThemeResult>((resolve) => {
      ordinal += 1;
      const requestId = `operator-theme:${Date.now()}:${ordinal}`;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve({ ok: false, error: "Operator theme change timed out." });
      }, timeoutMs);

      pending.set(requestId, { timeout, resolve });
      sendFrame({
        type: "operator_theme_set",
        requestId,
        theme: input.theme,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    }),

    resolve: (frame) => resolvePending(frame.requestId, {
      ok: frame.ok,
      ...(frame.appliedTheme ? { appliedTheme: frame.appliedTheme } : {}),
      ...(frame.error ? { error: frame.error } : {}),
    }),

    rejectAll: (error) => {
      for (const [requestId] of pending) {
        resolvePending(requestId, { ok: false, error });
      }
    },
  };
}
