import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResolvedMcpServer } from "../../../src/mcp/index.js";
import { KilnMcpClient, KilnMcpClientError } from "../../../src/mcp/client/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));

function fixtureServer(args: readonly string[] = []): ResolvedMcpServer {
  return {
    id: "stdio-fixture",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath, ...args],
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 100,
    admission: { state: "admitted" },
    source: "project",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
  };
}

describe("KilnMcpClient stdio integration", () => {
  it("discovers and uses tools, resources, and prompts over a real child process", async () => {
    const client = new KilnMcpClient(fixtureServer());
    try {
      const snapshot = await client.discover();
      expect(snapshot.tools.map(({ selector }) => selector)).toContain("mcp:stdio-fixture:tool:echo");
      expect(snapshot.resources[0]?.selector).toBe("mcp:stdio-fixture:resource:fixture%3A%2F%2Fstate");
      expect(snapshot.prompts[0]?.selector).toBe("mcp:stdio-fixture:prompt:inspect");
      await expect(client.callTool("mcp:stdio-fixture:tool:echo", { value: "argument with spaces" })).resolves.toMatchObject({ content: [{ text: '{"value":"argument with spaces"}' }] });
      await expect(client.readResource("mcp:stdio-fixture:resource:fixture%3A%2F%2Fstate")).resolves.toMatchObject({ contents: [{ text: "ready" }] });
      await expect(client.getPrompt("mcp:stdio-fixture:prompt:inspect", { subject: "place" })).resolves.toMatchObject({ messages: [{ content: { text: "inspect place" } }] });
    } finally {
      await client.disconnect();
    }
  });

  it("cancels a long-running request and shuts down the child", async () => {
    const client = new KilnMcpClient(fixtureServer());
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    try {
      await expect(client.callTool("mcp:stdio-fixture:tool:wait", {}, { signal: controller.signal })).rejects.toBeInstanceOf(KilnMcpClientError);
    } finally {
      await client.disconnect();
    }
  });

  it("fails closed on malformed protocol stdout and closes the child", async () => {
    const client = new KilnMcpClient(fixtureServer(["--malformed"]));
    try {
      await expect(client.connect()).rejects.toBeInstanceOf(KilnMcpClientError);
    } finally {
      await client.disconnect();
    }
  });

  it("reports an executable startup failure without leaking its path", async () => {
    const missing = "C:\\definitely-missing\\secret-server.exe";
    const client = new KilnMcpClient({ ...fixtureServer(), command: missing });
    const failure = await client.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KilnMcpClientError);
    expect((failure as Error).message).not.toContain(missing);
    await client.disconnect();
  });
});
