import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorThemeSetFrame } from "@kilnai/gateway-contracts";
import { createOperatorThemeBridge } from "../../src/gateway/operator-theme-bridge.js";

describe("operator theme bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a theme request frame and resolves the matching result", async () => {
    const sentFrames: OperatorThemeSetFrame[] = [];
    const bridge = createOperatorThemeBridge((frame) => {
      sentFrames.push(frame);
    });

    const result = bridge.request({ theme: "vesper", scope: "session", reason: "operator asked" });

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]).toMatchObject({
      type: "operator_theme_set",
      theme: "vesper",
      scope: "session",
      reason: "operator asked",
    });

    bridge.resolve({
      type: "operator_theme_set_result",
      requestId: sentFrames[0]!.requestId,
      ok: true,
      appliedTheme: "vesper",
    });

    await expect(result).resolves.toEqual({ ok: true, appliedTheme: "vesper" });
  });

  it("times out unresolved requests", async () => {
    const bridge = createOperatorThemeBridge(() => {}, 25);
    const result = bridge.request({ theme: "automata", scope: "session" });

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({
      ok: false,
      error: "Operator theme change timed out.",
    });
  });

  it("rejects all pending requests when the surface disconnects", async () => {
    const bridge = createOperatorThemeBridge(() => {});
    const result = bridge.request({ theme: "phosphor", scope: "persisted" });

    bridge.rejectAll("Operator surface disconnected.");

    await expect(result).resolves.toEqual({
      ok: false,
      error: "Operator surface disconnected.",
    });
  });
});
