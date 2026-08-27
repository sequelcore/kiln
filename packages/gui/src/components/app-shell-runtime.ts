import { useSessionStore } from "../lib/session-store/index.js";

const EXECUTION_TARGET_SELECTION_WAIT_TIMEOUT_MS = 5_500;
const PROVIDER_AUTH_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

export function toWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const gatewayPort = import.meta.env.VITE_GATEWAY_PORT as string | undefined;
  const authority = import.meta.env.DEV && gatewayPort
    ? `${window.location.hostname}:${gatewayPort}`
    : window.location.host;
  const url = new URL(`${protocol}//${authority}${path}`);
  const operatorToken = readOperatorToken();
  if (operatorToken) url.searchParams.set("operatorToken", operatorToken);
  return url.toString();
}

/** Ephemeral local-launch capability; the URL fragment never reaches the server. */
export function readOperatorToken(): string | undefined {
  return new URLSearchParams(window.location.hash.slice(1)).get("operatorToken")?.trim() || undefined;
}

export function resolveGatewayHttpBaseUrl(): string {
  const gatewayPort = import.meta.env.VITE_GATEWAY_PORT as string | undefined;
  if (import.meta.env.DEV && gatewayPort) {
    return `${window.location.protocol}//${window.location.hostname}:${gatewayPort}`;
  }
  return window.location.origin;
}

export function waitForExecutionTargetSelectionResolution(targetId: string, accountOverrideId?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + EXECUTION_TARGET_SELECTION_WAIT_TIMEOUT_MS;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
      callback();
    };

    const poll = () => {
      const state = useSessionStore.getState();
      if (!state.executionTargetSelecting) {
        if (state.activeTargetId === targetId && state.activeAccountOverrideId === (accountOverrideId ?? null)) {
          settle(resolve);
          return;
        }
        settle(() => {
          reject(new Error(
            state.providerOperationFailure?.operation === "select-target"
              ? state.providerOperationFailure.message
              : "Model selection failed.",
          ));
        });
        return;
      }
      if (Date.now() >= deadline) {
        settle(() => {
          reject(new Error("Model selection timed out. Please retry."));
        });
        return;
      }
      pollTimeoutId = setTimeout(poll, 50);
    };

    poll();
  });
}

export function waitForProviderAuthResolution(provider: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + PROVIDER_AUTH_WAIT_TIMEOUT_MS;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
      callback();
    };

    const poll = () => {
      const state = useSessionStore.getState();
      if (!state.providerAuthenticating) {
        const failure = state.providerOperationFailure;
        if (failure?.operation === "authenticate") {
          settle(() => reject(new Error(failure.message)));
          return;
        }
        settle(resolve);
        return;
      }
      if (state.providerAuthTarget?.provider !== provider) {
        settle(() => reject(new Error("Provider authentication target changed.")));
        return;
      }
      if (Date.now() >= deadline) {
        settle(() => reject(new Error("Provider authentication timed out. Please retry.")));
        return;
      }
      pollTimeoutId = setTimeout(poll, 100);
    };

    poll();
  });
}
