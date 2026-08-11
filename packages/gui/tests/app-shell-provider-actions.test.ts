import { describe, expect, it, vi } from "vitest";
import { createProviderPickerActions } from "../src/components/app-shell-provider-actions.js";

function createInput(overrides: Partial<Parameters<typeof createProviderPickerActions>[0]> = {}) {
  return {
    switchProvider: vi.fn(() => true),
    authenticateProvider: vi.fn(() => true),
    readErrorBanner: vi.fn(() => null),
    setErrorBanner: vi.fn(),
    onProvidersRefreshed: vi.fn(),
    sendRefreshProviders: vi.fn(),
    refetchDashboard: vi.fn(async () => ({ data: { providers: [] } })),
    waitForSwitch: vi.fn(async () => undefined),
    waitForAuth: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createProviderPickerActions", () => {
  it("normalizes provider model input and waits for switch completion", async () => {
    const input = createInput();
    const actions = createProviderPickerActions(input);

    await actions.onSwitchProvider("codex", "  gpt-5.5  ");

    expect(input.switchProvider).toHaveBeenCalledWith("codex", "gpt-5.5");
    expect(input.waitForSwitch).toHaveBeenCalledWith("codex", "gpt-5.5");
  });

  it("surfaces failed provider switch starts with the store error when available", async () => {
    const input = createInput({
      switchProvider: vi.fn(() => false),
      readErrorBanner: vi.fn(() => "quota unavailable"),
    });
    const actions = createProviderPickerActions(input);

    await expect(actions.onSwitchProvider("codex")).rejects.toThrow("quota unavailable");

    expect(input.setErrorBanner).toHaveBeenCalledWith("quota unavailable");
  });

  it("refreshes providers through background channels without invalidating the current catalog", async () => {
    const providers = [{ id: "opencode", models: ["kimi"], available: true }];
    const input = createInput({
      refetchDashboard: vi.fn(async () => ({ data: { providers } })),
    });
    const actions = createProviderPickerActions(input);

    await actions.onRefreshProviders();

    expect(input.sendRefreshProviders).toHaveBeenCalledTimes(1);
    expect(input.refetchDashboard).toHaveBeenCalledTimes(1);
    expect(input.onProvidersRefreshed).toHaveBeenCalledWith(providers);
  });

  it("rejects background refresh errors without invalidating the usable provider catalog", async () => {
    const input = createInput({
      refetchDashboard: vi.fn(async () => ({ error: new Error("offline") })),
    });
    const actions = createProviderPickerActions(input);

    await expect(actions.onRefreshProviders()).rejects.toThrow("Could not refresh provider discovery.");

    expect(input.onProvidersRefreshed).not.toHaveBeenCalled();
  });

  it("authenticates providers and waits for auth completion", async () => {
    const input = createInput();
    const actions = createProviderPickerActions(input);

    await actions.onAuthenticateProvider("opencode", { tier: "go" });

    expect(input.authenticateProvider).toHaveBeenCalledWith("opencode", { tier: "go" });
    expect(input.waitForAuth).toHaveBeenCalledWith("opencode");
  });
});
