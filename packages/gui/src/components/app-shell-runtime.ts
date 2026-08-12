import { useSessionStore } from "../lib/session-store/index.js";

const OPERATOR_TERMINAL_HEIGHT_KEY_PREFIX = "kiln.gui.operatorTerminalHeight";
export const DEFAULT_OPERATOR_TERMINAL_HEIGHT = 280;
export const MIN_OPERATOR_TERMINAL_HEIGHT = 160;
export const MAX_OPERATOR_TERMINAL_HEIGHT = 720;
export const OPERATOR_TERMINAL_PANEL_ID = "operator-terminal-panel";
const EXECUTION_ROUTE_SELECTION_WAIT_TIMEOUT_MS = 5_500;
const PROVIDER_AUTH_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

function clampOperatorTerminalHeight(height: number): number {
  return Math.min(
    Math.max(Math.round(height), MIN_OPERATOR_TERMINAL_HEIGHT),
    MAX_OPERATOR_TERMINAL_HEIGHT,
  );
}

function operatorTerminalHeightKey(workspaceScope: string): string {
  return `${OPERATOR_TERMINAL_HEIGHT_KEY_PREFIX}:${encodeURIComponent(workspaceScope.trim())}`;
}

export function readOperatorTerminalHeightPreference(workspaceScope: string): number {
  try {
    const stored = Number(localStorage.getItem(operatorTerminalHeightKey(workspaceScope)));
    return Number.isFinite(stored) && stored > 0
      ? clampOperatorTerminalHeight(stored)
      : DEFAULT_OPERATOR_TERMINAL_HEIGHT;
  } catch {
    return DEFAULT_OPERATOR_TERMINAL_HEIGHT;
  }
}

export function persistOperatorTerminalHeightPreference(workspaceScope: string, height: number): void {
  try {
    localStorage.setItem(operatorTerminalHeightKey(workspaceScope), String(clampOperatorTerminalHeight(height)));
  } catch {
    // Browser storage can be unavailable; the current panel remains usable in memory.
  }
}

export function toWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const gatewayPort = import.meta.env.VITE_GATEWAY_PORT as string | undefined;
  const authority = import.meta.env.DEV && gatewayPort
    ? `${window.location.hostname}:${gatewayPort}`
    : window.location.host;
  const url = new URL(`${protocol}//${authority}${path}`);
  const operatorToken = new URLSearchParams(window.location.hash.slice(1)).get("operatorToken")?.trim();
  if (operatorToken) url.searchParams.set("operatorToken", operatorToken);
  return url.toString();
}

export function resolveGatewayHttpBaseUrl(): string {
  const gatewayPort = import.meta.env.VITE_GATEWAY_PORT as string | undefined;
  if (import.meta.env.DEV && gatewayPort) {
    return `${window.location.protocol}//${window.location.hostname}:${gatewayPort}`;
  }
  return window.location.origin;
}

export function waitForExecutionRouteSelectionResolution(routeId: string, accountOverrideId?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + EXECUTION_ROUTE_SELECTION_WAIT_TIMEOUT_MS;
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
      if (!state.executionRouteSelecting) {
        if (state.activeRouteId === routeId && state.activeAccountOverrideId === (accountOverrideId ?? null)) {
          settle(resolve);
          return;
        }
        settle(() => {
          reject(new Error(
            state.providerOperationFailure?.operation === "select-route"
              ? state.providerOperationFailure.message
              : "Execution-route selection failed.",
          ));
        });
        return;
      }
      if (Date.now() >= deadline) {
        settle(() => {
          reject(new Error("Execution-route selection timed out. Please retry."));
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
