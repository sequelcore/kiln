import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliChannel } from "../../src/channels/cli-channel.js";
import type { IncomingMessage, OutgoingMessage, EngineEvent } from "@kilnai/core";

describe("CliChannel", () => {
  let channel: CliChannel;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    channel = new CliChannel();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("has correct name and default format", () => {
    expect(channel.name).toBe("cli");
    expect(channel.defaultFormat).toBe("full");
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        content: "Fix the bug",
        source: "stdin",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      const msg: IncomingMessage = { content: "hello", source: "stdin" };
      await expect(channel.receive(msg)).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("writes formatted content to stdout", async () => {
      const msg: OutgoingMessage = {
        content: "Task complete",
        target: "user",
      };
      await channel.send(msg);

      expect(writeSpy).toHaveBeenCalledWith("Task complete\n");
    });

    it("uses provided format over default", async () => {
      const msg: OutgoingMessage = {
        content: "**Bold** text",
        target: "user",
        format: "short",
      };
      await channel.send(msg);

      // Short format strips markdown
      const output = writeSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain("**");
      expect(output).toContain("Bold");
    });
  });

  describe("stream()", () => {
    it("writes events to stdout", async () => {
      async function* events(): AsyncGenerator<EngineEvent> {
        yield { type: "phase_changed", timestamp: new Date(), payload: { phase: "analyze" } };
        yield { type: "task_started", timestamp: new Date(), payload: { taskId: "t1" } };
      }

      await channel.stream(events());

      expect(writeSpy).toHaveBeenCalledTimes(2);
      const firstCall = writeSpy.mock.calls[0]![0] as string;
      expect(firstCall).toContain("[phase_changed]");
      expect(firstCall).toContain("analyze");
    });
  });
});
