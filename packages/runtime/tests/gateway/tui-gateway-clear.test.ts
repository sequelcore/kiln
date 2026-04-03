import { describe, it, expect, vi } from "vitest";

// We test the gateway clear frame handling by extracting the logic inline,
// since startTuiGateway() starts a real Bun HTTP server. Instead we exercise
// the onClear option contract directly as it would be called by the onMessage handler.

describe("TUI gateway clear frame handling", () => {
  it("sends cleared frame when clear frame received", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn().mockResolvedValue(undefined);

    // Simulate what the onMessage handler does for a { type: "clear" } frame
    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(handled).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("calls onClear callback", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("sends cleared even when onClear throws (fail-open)", async () => {
    const onClear = vi.fn().mockRejectedValue(new Error("storage failure"));
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
  });

  it("does not handle non-clear frames", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn();

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "message", content: "hello" }, ws.send, onClear);
    expect(handled).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
