import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable, Writable } from "node:stream";
import { AgentCard, Message, Role, Task, TaskState } from "@a2a-js/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  A2AClient,
  A2A_MAX_RESPONSE_BYTES,
  type A2AClientFactory,
  type A2AEgressFetchPort,
  type A2AHostnameResolver,
  A2ATimeoutError,
  createOfficialA2AClientFactory,
  createPinnedHttpsA2AEgressFetch,
} from "../../src/a2a/a2a-client.js";

const publicResolver: A2AHostnameResolver = { lookup: async () => ["8.8.8.8", "2606:4700:4700::1111"] };

function agentCard(): AgentCard {
  return AgentCard.fromJSON({
    name: "test-agent",
    description: "Test agent",
    supportedInterfaces: [{ url: "https://agent.example/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    version: "1.0.0",
    capabilities: {},
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["application/json"],
    skills: [],
  });
}

function userMessage(): Message {
  return Message.fromJSON({
    kind: "message",
    messageId: "message-1",
    role: "ROLE_USER",
    parts: [{ kind: "text", text: "Hello" }],
  });
}

function responseFromChunks(
  chunks: readonly (Buffer | string)[],
  status = 200,
  headers: Record<string, string> = {},
): IncomingMessage {
  const response = Readable.from(chunks) as IncomingMessage;
  response.statusCode = status;
  response.statusMessage = status === 200 ? "OK" : "Internal Server Error";
  response.headers = headers;
  response.rawHeaders = Object.entries(headers).flat();
  return response;
}

function httpsRequestFor(response: IncomingMessage): {
  readonly httpsRequest: Parameters<typeof createPinnedHttpsA2AEgressFetch>[0];
  readonly outgoing: ClientRequest;
} {
  const outgoing = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }) as ClientRequest;
  const httpsRequest = vi.fn(
    (_options: Record<string, unknown>, callback: (incoming: IncomingMessage) => void) => {
      queueMicrotask(() => callback(response));
      return outgoing;
    },
  ) as unknown as Parameters<typeof createPinnedHttpsA2AEgressFetch>[0];
  return { httpsRequest, outgoing };
}

describe("A2AClient", () => {
  it("uses the v1 Agent Card discovery path through the official resolver", async () => {
    const card = agentCard();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(AgentCard.toJSON(card)), { status: 200 }));
    const factory = createOfficialA2AClientFactory(publicResolver, { fetch: fetchImpl });

    await expect(new A2AClient(factory, publicResolver).discoverAgent("https://agent.example")).resolves.toMatchObject({
      name: "test-agent",
      supportedInterfaces: [{ protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    });
    const [cardUrl, request] = fetchImpl.mock.calls[0]!;
    expect(String(cardUrl)).toBe("https://agent.example/.well-known/agent-card.json");
    expect(request).toEqual({ headers: { "A2A-Version": "1.0" }, redirect: "error" });
    expect(fetchImpl.mock.calls[0]![2]).toEqual(["8.8.8.8", "2606:4700:4700::1111"]);
  });

  it("does not reach egress when DNS changes from public validation to a private SDK fetch", async () => {
    const lookup = vi.fn().mockResolvedValueOnce(["8.8.8.8"]).mockResolvedValueOnce(["169.254.169.254"]);
    const egress: A2AEgressFetchPort = { fetch: vi.fn() };

    await expect(new A2AClient(undefined, { lookup }, egress).discoverAgent("https://agent.example")).rejects.toThrow(
      "A2A agent discovery failed",
    );

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(egress.fetch).not.toHaveBeenCalled();
  });

  it("pins every official SDK fetch to the addresses approved for that fetch", async () => {
    const card = agentCard();
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(["8.8.8.8"])
      .mockResolvedValueOnce(["1.1.1.1"])
      .mockResolvedValueOnce(["9.9.9.9"]);
    const egress: A2AEgressFetchPort = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(AgentCard.toJSON(card)), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                task: Task.toJSON(
                  Task.fromJSON({
                    id: "task-1",
                    contextId: "context-1",
                    status: { state: "TASK_STATE_COMPLETED" },
                  }),
                ),
              },
            }),
            { status: 200 },
          ),
        ),
    };

    await new A2AClient(undefined, { lookup }, egress).sendMessage("https://agent.example", userMessage());

    expect(egress.fetch).toHaveBeenCalledTimes(2);
    expect(egress.fetch).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ redirect: "error" }), [
      "1.1.1.1",
    ]);
    expect(egress.fetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ redirect: "error" }), [
      "9.9.9.9",
    ]);
  });

  it("blocks a private rebinding before the second SDK fetch reaches egress", async () => {
    const card = agentCard();
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(["8.8.8.8"])
      .mockResolvedValueOnce(["1.1.1.1"])
      .mockResolvedValueOnce(["10.0.0.1"]);
    const egress: A2AEgressFetchPort = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(AgentCard.toJSON(card)), { status: 200 })),
    };

    await expect(
      new A2AClient(undefined, { lookup }, egress).sendMessage("https://agent.example", userMessage()),
    ).rejects.toThrow("A2A message request failed");

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(egress.fetch).toHaveBeenCalledTimes(1);
  });

  it("connects the default egress directly to an approved IP while preserving Host and TLS identity", async () => {
    let requestOptions: Record<string, unknown> | undefined;
    const httpsRequest = vi.fn((options: Record<string, unknown>, callback: (response: IncomingMessage) => void) => {
      requestOptions = options;
      const response = Readable.from([JSON.stringify({ ok: true })]) as IncomingMessage;
      response.statusCode = 200;
      response.statusMessage = "OK";
      response.rawHeaders = ["content-type", "application/json"];
      queueMicrotask(() => callback(response));
      return new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }) as ClientRequest;
    }) as unknown as Parameters<typeof createPinnedHttpsA2AEgressFetch>[0];

    const response = await createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(
      new URL("https://agent.example/a2a?tenant=one"),
      { method: "POST", body: "{}", redirect: "error" },
      ["8.8.8.8"],
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(requestOptions).toMatchObject({
      hostname: "8.8.8.8",
      port: 443,
      path: "/a2a?tenant=one",
      servername: "agent.example",
      agent: false,
      rejectUnauthorized: true,
      headers: expect.objectContaining({ host: "agent.example" }),
    });
  });

  it("rejects redirects inside the pinned egress", async () => {
    const httpsRequest = vi.fn((_options: Record<string, unknown>, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([]) as IncomingMessage;
      response.statusCode = 302;
      response.statusMessage = "Found";
      response.rawHeaders = ["location", "https://private.example/"];
      queueMicrotask(() => callback(response));
      return new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }) as ClientRequest;
    }) as unknown as Parameters<typeof createPinnedHttpsA2AEgressFetch>[0];

    await expect(
      createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(new URL("https://agent.example/a2a"), { redirect: "error" }, [
        "8.8.8.8",
      ]),
    ).rejects.toThrow("redirects are not allowed");
  });

  it("rejects an invalid or oversized Content-Length before accumulating a response", async () => {
    for (const declared of ["not-a-length", String(A2A_MAX_RESPONSE_BYTES + 1)]) {
      const response = responseFromChunks(["credential=secret"], 200, { "content-length": declared });
      const destroy = vi.spyOn(response, "destroy");
      const { httpsRequest, outgoing } = httpsRequestFor(response);
      const outgoingDestroy = vi.spyOn(outgoing, "destroy");

      await expect(
        createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(new URL("https://agent.example/a2a"), {}, ["8.8.8.8"]),
      ).rejects.toMatchObject({ code: "A2A_CLIENT_FAILED" });
      expect(destroy).toHaveBeenCalled();
      expect(outgoingDestroy).toHaveBeenCalled();
    }
  });

  it("bounds error response bodies before accumulation", async () => {
    const response = responseFromChunks(["credential=secret"], 500, { "content-length": String(A2A_MAX_RESPONSE_BYTES + 1) });
    const destroy = vi.spyOn(response, "destroy");
    const { httpsRequest } = httpsRequestFor(response);

    const failure = createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(
      new URL("https://agent.example/a2a"),
      {},
      ["8.8.8.8"],
    );
    await expect(failure).rejects.toMatchObject({ code: "A2A_CLIENT_FAILED" });
    await expect(failure).rejects.not.toThrow("credential=secret");
    expect(destroy).toHaveBeenCalled();
  });

  it("destroys a chunked response when cumulative bytes cross the transport limit", async () => {
    const response = responseFromChunks([Buffer.alloc(A2A_MAX_RESPONSE_BYTES), Buffer.from("overflow")]);
    const destroy = vi.spyOn(response, "destroy");
    const { httpsRequest, outgoing } = httpsRequestFor(response);
    const outgoingDestroy = vi.spyOn(outgoing, "destroy");

    await expect(
      createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(new URL("https://agent.example/a2a"), {}, ["8.8.8.8"]),
    ).rejects.toMatchObject({
      code: "A2A_CLIENT_FAILED",
      context: { failureKind: "response-too-large" },
    });
    expect(destroy).toHaveBeenCalled();
    expect(outgoingDestroy).toHaveBeenCalled();
    expect(response.listenerCount("data")).toBe(0);
    expect(response.listenerCount("end")).toBe(0);
    expect(response.listenerCount("error")).toBe(0);
    expect(outgoing.listenerCount("error")).toBe(0);
  });

  it("accepts a response exactly at the transport limit", async () => {
    const response = responseFromChunks([Buffer.alloc(A2A_MAX_RESPONSE_BYTES, 0x61)], 200, {
      "content-length": String(A2A_MAX_RESPONSE_BYTES),
    });
    const { httpsRequest } = httpsRequestFor(response);

    const result = await createPinnedHttpsA2AEgressFetch(httpsRequest).fetch(
      new URL("https://agent.example/a2a"),
      {},
      ["8.8.8.8"],
    );
    expect((await result.arrayBuffer()).byteLength).toBe(A2A_MAX_RESPONSE_BYTES);
  });

  it.each([
    "http://agent.example",
    "https://user:pass@agent.example",
    "https://agent.example/#fragment",
    "https://agent.example:444",
    "https://127.0.0.1",
  ])("rejects invalid target %s before invoking the official factory", async (target) => {
    const factory: A2AClientFactory = { createFromUrl: vi.fn() };
    await expect(new A2AClient(factory, publicResolver).discoverAgent(target)).rejects.toThrow(
      "public canonical HTTPS",
    );
    expect(factory.createFromUrl).not.toHaveBeenCalled();
  });

  it("rejects mixed public/private DNS answers and lookup failures before the factory", async () => {
    const factory: A2AClientFactory = { createFromUrl: vi.fn() };
    await expect(
      new A2AClient(factory, { lookup: async () => ["8.8.8.8", "169.254.169.254"] }).sendMessage(
        "https://agent.example",
        userMessage(),
      ),
    ).rejects.toThrow("public canonical HTTPS");
    await expect(
      new A2AClient(factory, {
        lookup: async () => {
          throw new Error("dns failure");
        },
      }).sendMessage("https://agent.example", userMessage()),
    ).rejects.toThrow("public canonical HTTPS");
    expect(factory.createFromUrl).not.toHaveBeenCalled();
  });

  it.each([
    "https://10.0.0.1",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://224.0.0.1",
    "https://[::]",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[ff02::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[2001:db8::1]",
  ])("rejects private, link-local, multicast, mapped, and reserved literal %s", async (target) => {
    const factory: A2AClientFactory = { createFromUrl: vi.fn() };
    await expect(new A2AClient(factory, publicResolver).discoverAgent(target)).rejects.toThrow(
      "public canonical HTTPS",
    );
    expect(factory.createFromUrl).not.toHaveBeenCalled();
  });

  it("allows a public literal IP without DNS lookup", async () => {
    const remote = { getAgentCard: vi.fn().mockResolvedValue(agentCard()), sendMessage: vi.fn(), cancelTask: vi.fn() };
    const factory: A2AClientFactory = { createFromUrl: vi.fn().mockResolvedValue(remote) };
    const resolver: A2AHostnameResolver = { lookup: vi.fn() };
    await expect(new A2AClient(factory, resolver).discoverAgent("https://8.8.8.8")).resolves.toEqual(agentCard());
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it("discovers a v1 Agent Card through ClientFactory.createFromUrl", async () => {
    const card = agentCard();
    const remote = { getAgentCard: vi.fn().mockResolvedValue(card), sendMessage: vi.fn(), cancelTask: vi.fn() };
    const factory: A2AClientFactory = { createFromUrl: vi.fn().mockResolvedValue(remote) };

    await expect(new A2AClient(factory, publicResolver).discoverAgent("https://agent.example")).resolves.toEqual(card);
    expect(factory.createFromUrl).toHaveBeenCalledWith("https://agent.example");
  });

  it("uses official sendMessage and forwards an AbortSignal", async () => {
    const response = Task.fromJSON({
      id: "task-1",
      contextId: "context-1",
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [],
    });
    const sendMessage = vi.fn().mockResolvedValue(response);
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockResolvedValue({ getAgentCard: vi.fn(), sendMessage, cancelTask: vi.fn() }),
    };

    await expect(
      new A2AClient(factory, publicResolver).sendMessage("https://agent.example", userMessage(), 1_000),
    ).resolves.toEqual(response);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ role: Role.ROLE_USER }) }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("returns a direct Message response", async () => {
    const response = Message.fromJSON({
      kind: "message",
      messageId: "message-2",
      role: "ROLE_AGENT",
      parts: [{ kind: "data", data: { answer: 42 } }],
    });
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockResolvedValue({
        getAgentCard: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(response),
        cancelTask: vi.fn(),
      }),
    };

    await expect(
      new A2AClient(factory, publicResolver).sendMessage("https://agent.example", userMessage()),
    ).resolves.toEqual(response);
  });

  it("aborts timed-out sendMessage calls and exposes a sanitized Kiln error", async () => {
    let observedSignal: AbortSignal | undefined;
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockResolvedValue({
        getAgentCard: vi.fn(),
        sendMessage: vi.fn((_request, options) => {
          observedSignal = options?.signal;
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
          });
        }),
        cancelTask: vi.fn(),
      }),
    };

    await expect(
      new A2AClient(factory, publicResolver).sendMessage("https://secret.example/a2a", userMessage(), 5),
    ).rejects.toThrow("A2A message request timed out");
    expect(observedSignal?.aborted).toBe(true);
  });

  it("applies the same timeout while ClientFactory discovers the Agent Card", async () => {
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    const failure = new A2AClient(factory, publicResolver).sendMessage("https://agent.example", userMessage(), 5);
    await expect(failure).rejects.toBeInstanceOf(A2ATimeoutError);
    await expect(failure).rejects.toMatchObject({ code: "A2A_TIMEOUT" });
  });

  it("cancels a task through the official client with an AbortSignal", async () => {
    const cancelTask = vi
      .fn()
      .mockResolvedValue(
        Task.fromJSON({ id: "task-1", contextId: "context-1", status: { state: "TASK_STATE_CANCELED" } }),
      );
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockResolvedValue({ getAgentCard: vi.fn(), sendMessage: vi.fn(), cancelTask }),
    };

    await new A2AClient(factory, publicResolver).cancelTask("https://agent.example", "task-1", 1_000);

    expect(cancelTask).toHaveBeenCalledWith(
      { tenant: "", id: "task-1", metadata: undefined },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("sanitizes SDK discovery failures", async () => {
    const factory: A2AClientFactory = {
      createFromUrl: vi.fn().mockRejectedValue(new Error("credential=secret")),
    };

    await expect(new A2AClient(factory, publicResolver).discoverAgent("https://agent.example")).rejects.toThrow(
      "A2A agent discovery failed",
    );
  });

  it("uses v1 task states in fixtures", () => {
    expect(TaskState.TASK_STATE_COMPLETED).not.toBe(TaskState.TASK_STATE_FAILED);
  });
});
