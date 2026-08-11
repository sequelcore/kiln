import type { GuiOutboundFrame } from "@kilnai/gateway-contracts";
import type { ProviderDescriptor } from "../lib/session-store/index.js";
import {
  waitForProviderAuthResolution,
  waitForProviderSwitchResolution,
} from "./app-shell-runtime.js";

interface ProviderRefreshResult {
  readonly error?: unknown;
  readonly data?: {
    readonly providers?: readonly ProviderDescriptor[];
  };
}

interface ProviderPickerActionsInput {
  readonly switchProvider: (provider: string, model?: string) => boolean;
  readonly authenticateProvider: (provider: string, options?: { apiKey?: string; tier?: "go" | "zen" }) => boolean;
  readonly readErrorBanner: () => string | null;
  readonly setErrorBanner: (message: string) => void;
  readonly onProvidersRefreshed: (providers: readonly ProviderDescriptor[]) => void;
  readonly sendRefreshProviders: () => void;
  readonly refetchDashboard: () => Promise<ProviderRefreshResult | undefined>;
  readonly waitForSwitch?: (provider: string, model: string | null) => Promise<void>;
  readonly waitForAuth?: (provider: string) => Promise<void>;
}

function normalizeRequestedModel(model?: string): string | null {
  return typeof model === "string" && model.trim().length > 0 ? model.trim() : null;
}

function raiseProviderError(input: ProviderPickerActionsInput, fallback: string): never {
  const message = input.readErrorBanner() ?? fallback;
  input.setErrorBanner(message);
  throw new Error(message);
}

function normalizeProviderError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function createProviderPickerActions(input: ProviderPickerActionsInput) {
  const waitForSwitch = input.waitForSwitch ?? waitForProviderSwitchResolution;
  const waitForAuth = input.waitForAuth ?? waitForProviderAuthResolution;

  const onSwitchProvider = async (provider: string, model?: string): Promise<void> => {
    const normalizedModel = normalizeRequestedModel(model);
    const started = input.switchProvider(provider, normalizedModel ?? undefined);
    if (!started) {
      raiseProviderError(input, "Provider switch failed.");
    }

    try {
      await waitForSwitch(provider, normalizedModel);
    } catch (error) {
      const normalized = normalizeProviderError(error, "Provider switch failed.");
      input.setErrorBanner(normalized.message);
      throw normalized;
    }
  };

  const onRefreshProviders = async (): Promise<void> => {
    input.sendRefreshProviders();
    const result = await input.refetchDashboard();
    if (result?.error) {
      throw new Error("Could not refresh provider discovery.");
    }
    if (result?.data?.providers) {
      input.onProvidersRefreshed(result.data.providers);
    }
  };

  const onAuthenticateProvider = async (
    provider: string,
    options?: { apiKey?: string; tier?: "go" | "zen" },
  ): Promise<void> => {
    const started = input.authenticateProvider(provider, options);
    if (!started) {
      raiseProviderError(input, "Provider authentication failed.");
    }
    try {
      await waitForAuth(provider);
    } catch (error) {
      const normalized = normalizeProviderError(error, "Provider authentication failed.");
      input.setErrorBanner(normalized.message);
      throw normalized;
    }
  };

  return {
    onSwitchProvider,
    onRefreshProviders,
    onAuthenticateProvider,
  };
}

export type ProviderRefreshFrame = Extract<GuiOutboundFrame, { type: "refresh_providers" }>;
