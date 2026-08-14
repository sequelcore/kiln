import { describe, expect, it, vi } from "vitest";
import { type CodexThreadContinuityTransport, runCodexThreadContinuityProof } from "./codex-thread-continuity.js";

interface JsonObject {
  readonly [key: string]: unknown;
}

function scriptedTransport(
  onRequest: (request: JsonObject) => JsonObject,
): CodexThreadContinuityTransport & { readonly writes: JsonObject[] } {
  const writes: JsonObject[] = [];
  const responses: string[] = [];
  return {
    writes,
    sendLine: (line) => {
      const request = JSON.parse(line) as JsonObject;
      writes.push(request);
      if ("id" in request) responses.push(JSON.stringify(onRequest(request)));
    },
    readLine: async () => responses.shift() ?? null,
  };
}

describe("Codex thread continuity proof", () => {
  it("performs the v2 handshake and lists bounded pages without provider filtering or content", async () => {
    const transport = scriptedTransport((request) => {
      if (request.method === "initialize") {
        return { id: request.id, result: { userAgent: "codex-test" } };
      }
      if (request.method === "thread/list") {
        const params = request.params as JsonObject;
        return params.cursor === null
          ? {
              id: request.id,
              result: {
                data: [{ id: "thread-openai", modelProvider: "openai", preview: "private title", cwd: "private cwd" }],
                nextCursor: "cursor-1",
              },
            }
          : {
              id: request.id,
              result: {
                data: [{ id: "thread-kiln", modelProvider: "kiln", title: "private title" }],
                nextCursor: null,
              },
            };
      }
      throw new Error("unexpected request");
    });

    await expect(
      runCodexThreadContinuityProof({
        transport,
        maxPages: 4,
        maxItems: 5,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({
      protocol: "codex-app-server-v2",
      pagesRead: 2,
      itemsRead: 2,
      providerCounts: { openai: 1, kiln: 1 },
      truncated: false,
      resume: null,
    });

    expect(transport.writes).toEqual([
      {
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "kiln", title: "Kiln", version: "3.0.0-beta.1" },
          capabilities: null,
        },
      },
      { method: "initialized" },
      {
        method: "thread/list",
        id: 2,
        params: { cursor: null, limit: 5 },
      },
      {
        method: "thread/list",
        id: 3,
        params: { cursor: "cursor-1", limit: 4 },
      },
    ]);
    for (const request of transport.writes) {
      if (request.method === "thread/list") {
        expect(request.params).not.toHaveProperty("modelProviders");
      }
    }
  });

  it("resumes only the exact disposable id with the Kiln provider and excludes turns", async () => {
    const transport = scriptedTransport((request) => {
      if (request.method === "initialize") return { id: request.id, result: {} };
      if (request.method === "thread/list") {
        return { id: request.id, result: { data: [], nextCursor: null } };
      }
      if (request.method === "thread/resume") {
        return {
          id: request.id,
          result: {
            thread: {
              id: "disposable-thread",
              modelProvider: "kiln",
              turns: [{ role: "user", content: "private turn" }],
            },
          },
        };
      }
      throw new Error("unexpected request");
    });

    await expect(
      runCodexThreadContinuityProof({
        transport,
        resumeThreadId: "disposable-thread",
        maxPages: 1,
        maxItems: 1,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      resume: {
        threadId: "disposable-thread",
        modelProvider: "kiln",
        exactThreadId: true,
      },
    });

    expect(transport.writes.at(-1)).toEqual({
      method: "thread/resume",
      id: 3,
      params: {
        threadId: "disposable-thread",
        modelProvider: "kiln",
        excludeTurns: true,
      },
    });
  });

  it("stops at page and item bounds and reports truncation without looping cursors", async () => {
    const transport = scriptedTransport((request) => {
      if (request.method === "initialize") return { id: request.id, result: {} };
      if (request.method === "thread/list") {
        return {
          id: request.id,
          result: {
            data: [{ id: `thread-${String(request.id)}`, modelProvider: "kiln" }],
            nextCursor: `cursor-${String(request.id)}`,
          },
        };
      }
      throw new Error("unexpected request");
    });

    await expect(
      runCodexThreadContinuityProof({
        transport,
        maxPages: 2,
        maxItems: 10,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      pagesRead: 2,
      itemsRead: 2,
      truncated: true,
    });
    expect(transport.writes.filter((request) => request.method === "thread/list")).toHaveLength(2);
  });

  it("sanitizes protocol failures and cleans up a timed-out transport", async () => {
    const abort = vi.fn();
    const kill = vi.fn();
    const close = vi.fn();
    const transport: CodexThreadContinuityTransport = {
      sendLine: vi.fn(),
      readLine: vi.fn(() => new Promise<string>(() => {})),
      abort,
      kill,
      close,
    };

    await expect(
      runCodexThreadContinuityProof({
        transport,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched response ids without exposing server text", async () => {
    const transport: CodexThreadContinuityTransport = {
      sendLine: vi.fn(),
      readLine: vi.fn(async () =>
        JSON.stringify({
          id: 999,
          error: { message: "secret title from a private rollout" },
        }),
      ),
    };

    const error = await runCodexThreadContinuityProof({ transport }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "protocol" });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret title");
  });
});
