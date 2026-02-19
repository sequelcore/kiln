import { describe, it, expect } from "vitest";
import type {
  Channel,
  MessageFormat,
  IncomingMessage,
  OutgoingMessage,
  EngineEvent,
} from "../../src/engine/domain/channel.js";

describe("Channel interface", () => {
  it("IncomingMessage accepts required fields only", () => {
    const msg: IncomingMessage = {
      content: "Hello",
      source: "cli",
    };
    expect(msg.content).toBe("Hello");
    expect(msg.source).toBe("cli");
    expect(msg.metadata).toBeUndefined();
    expect(msg.userId).toBeUndefined();
    expect(msg.threadId).toBeUndefined();
  });

  it("IncomingMessage accepts optional routing fields", () => {
    const msg: IncomingMessage = {
      content: "Hello",
      source: "slack",
      userId: "U123",
      threadId: "T456",
      metadata: { channelId: "C789" },
    };
    expect(msg.userId).toBe("U123");
    expect(msg.threadId).toBe("T456");
    expect(msg.metadata).toEqual({ channelId: "C789" });
  });

  it("OutgoingMessage accepts required fields only", () => {
    const response: OutgoingMessage = {
      content: "Here is the result",
      target: "cli",
    };
    expect(response.content).toBe("Here is the result");
    expect(response.target).toBe("cli");
    expect(response.format).toBeUndefined();
    expect(response.metadata).toBeUndefined();
  });

  it("OutgoingMessage accepts format and routing fields", () => {
    const response: OutgoingMessage = {
      content: "Result",
      target: "slack",
      format: "full",
      userId: "U123",
      threadId: "T456",
      metadata: { tokens: 42 },
    };
    expect(response.format).toBe("full");
    expect(response.userId).toBe("U123");
    expect(response.threadId).toBe("T456");
  });

  it("MessageFormat supports short, full, structured", () => {
    const formats: MessageFormat[] = ["short", "full", "structured"];
    expect(formats).toHaveLength(3);
  });

  it("EngineEvent has type, timestamp, and payload", () => {
    const now = new Date();
    const event: EngineEvent = {
      type: "phase_started",
      timestamp: now,
      payload: { phase: "Implement" },
    };
    expect(event.type).toBe("phase_started");
    expect(event.timestamp).toBe(now);
    expect(event.payload).toEqual({ phase: "Implement" });
  });

  it("Channel mock implementation satisfies the interface", async () => {
    const received: IncomingMessage[] = [];
    const sent: OutgoingMessage[] = [];

    const channel: Channel = {
      name: "test-channel",
      defaultFormat: "full",
      async receive(message) {
        received.push(message);
      },
      async send(response) {
        sent.push(response);
      },
      async stream(_events) {},
    };

    await channel.receive({ content: "task", source: "cli" });
    await channel.send({ content: "done", target: "cli", format: "full" });

    expect(received).toHaveLength(1);
    expect(received[0]!.content).toBe("task");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.format).toBe("full");
    expect(channel.name).toBe("test-channel");
    expect(channel.defaultFormat).toBe("full");
  });

  it("stream() accepts an AsyncIterable of EngineEvent", async () => {
    const collected: EngineEvent[] = [];

    const channel: Channel = {
      name: "stream-channel",
      defaultFormat: "full",
      async receive() {},
      async send() {},
      async stream(events) {
        for await (const event of events) {
          collected.push(event);
        }
      },
    };

    async function* makeEvents(): AsyncIterable<EngineEvent> {
      yield { type: "task_created", timestamp: new Date(), payload: { id: "1" } };
      yield { type: "task_completed", timestamp: new Date(), payload: { id: "1" } };
    }

    await channel.stream(makeEvents());

    expect(collected).toHaveLength(2);
    expect(collected[0]!.type).toBe("task_created");
    expect(collected[1]!.type).toBe("task_completed");
  });
});
