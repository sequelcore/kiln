import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { KilnProvider } from "../src/provider.js";
import { useKilnChat } from "../src/use-kiln-chat.js";
import type { KilnConfig, ChatMessage } from "../src/types.js";
import type { ContentPart } from "@kilnai/core";

function createWrapper(config: KilnConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KilnProvider, { config }, children);
  };
}

function mockFetch(response: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }),
  );
}

function mockFetchError(status: number, statusText: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
    }),
  );
}

describe("useKilnChat", () => {
  const config: KilnConfig = {
    baseUrl: "http://localhost:4000",
    appName: "test-app",
    userId: "user-1",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with empty messages, no error, not loading", () => {
    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("send() with string content adds user message with content field", async () => {
    mockFetch({ content: "hello back" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("hello");
    expect(userMsg!.parts).toBeUndefined();
  });

  it("send() with ContentPart[] sets parts field and empty content", async () => {
    mockFetch({ content: "I see the image" });

    const parts: ContentPart[] = [
      { type: "image", mimeType: "image/png", data: "abc123" },
    ];

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send(parts);
    });

    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("");
    expect(userMsg!.parts).toEqual(parts);
  });

  it("send() adds assistant message from API response", async () => {
    mockFetch({ content: "assistant reply" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.messages).toHaveLength(2);
    const assistantMsg = result.current.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("assistant reply");
  });

  it("send() preserves REST response parts on assistant message", async () => {
    const responseParts: ContentPart[] = [
      { type: "text", text: "spoken answer" },
      { type: "audio", mimeType: "audio/mpeg", data: "AQID" },
    ];
    mockFetch({ content: "spoken answer", parts: responseParts });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    const assistantMsg = result.current.messages[1];
    expect(assistantMsg.parts).toEqual(responseParts);
  });

  it("send() posts parts in request body when content is ContentPart[]", async () => {
    mockFetch({ content: "ok" });

    const parts: ContentPart[] = [
      { type: "text", text: "describe this" },
    ];

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send(parts);
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.parts).toEqual(parts);
  });

  it("send() posts requestedAuthority from per-send options", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("just text", { requestedAuthority: "audited" });
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.requestedAuthority).toBe("audited");
  });

  it("send() posts requestedAuthority from hook options", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(() => useKilnChat({ requestedAuthority: "read_only" }), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("just text");
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.requestedAuthority).toBe("read_only");
  });

  it("send() does not include parts in request body for string content", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("just text");
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.parts).toBeUndefined();
  });

  it("clearMessages() empties the messages array and clears error", async () => {
    mockFetch({ content: "hi" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("error from API sets error state", async () => {
    mockFetchError(500, "Internal Server Error");

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toContain("500");
  });

  it("isLoading is true during send and false after completion", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.send("hello");
    });

    // isLoading should be true while waiting
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ content: "done" }),
      });
      await sendPromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("isLoading resets to false on error", async () => {
    mockFetchError(500, "Server Error");

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("message IDs increment across user and assistant messages", async () => {
    mockFetch({ content: "reply 1" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("first");
    });

    expect(result.current.messages[0].id).toBe("1"); // user
    expect(result.current.messages[1].id).toBe("2"); // assistant

    mockFetch({ content: "reply 2" });

    await act(async () => {
      await result.current.send("second");
    });

    expect(result.current.messages[2].id).toBe("3"); // user
    expect(result.current.messages[3].id).toBe("4"); // assistant
  });

  it("sends to correct URL with appName from config", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:4000/apps/test-app/message");
  });

  it("uses appName from options over config", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(
      () => useKilnChat({ appName: "override-app" }),
      { wrapper: createWrapper(config) },
    );

    await act(async () => {
      await result.current.send("hello");
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:4000/apps/override-app/message");
  });

  it("includes userId and sessionId in request body", async () => {
    mockFetch({ content: "ok" });

    const { result } = renderHook(
      () => useKilnChat({ sessionId: "sess-42" }),
      { wrapper: createWrapper(config) },
    );

    await act(async () => {
      await result.current.send("hello");
    });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.userId).toBe("user-1");
    expect(body.sessionId).toBe("sess-42");
  });

  it("new send() clears previous error", async () => {
    mockFetchError(500, "Server Error");

    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("fail");
    });

    expect(result.current.error).not.toBeNull();

    mockFetch({ content: "ok" });

    await act(async () => {
      await result.current.send("succeed");
    });

    expect(result.current.error).toBeNull();
  });

  it("messages have timestamps", async () => {
    mockFetch({ content: "hi" });

    const before = Date.now();
    const { result } = renderHook(() => useKilnChat(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.send("hello");
    });
    const after = Date.now();

    for (const msg of result.current.messages) {
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    }
  });
});
