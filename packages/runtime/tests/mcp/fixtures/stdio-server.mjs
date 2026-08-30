import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

if (process.argv.includes("--malformed")) {
  process.stdout.write("this is not json-rpc\n");
  setInterval(() => undefined, 1_000);
} else {
  serveStdio(
    () => {
      const server = new Server(
        { name: "kiln-fixture", version: "1.0.0" },
        {
          capabilities: { tools: {}, resources: {}, prompts: {} },
          supportedProtocolVersions: ["2026-07-28"],
        },
      );
      server.setRequestHandler("tools/list", async () => ({
        tools: [
          { name: "echo", description: "Fixture echo", inputSchema: { type: "object" } },
          { name: "wait", description: "Fixture wait", inputSchema: { type: "object" } },
        ],
      }));
      server.setRequestHandler("tools/call", async ({ params }, { signal }) => {
        if (params.name === "wait") {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 60_000);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("cancelled"));
              },
              { once: true },
            );
          });
        }
        return { content: [{ type: "text", text: JSON.stringify(params.arguments ?? {}) }] };
      });
      server.setRequestHandler("resources/list", async () => ({
        resources: [{ uri: "fixture://state", name: "state", mimeType: "text/plain" }],
      }));
      server.setRequestHandler("resources/read", async () => ({
        contents: [{ uri: "fixture://state", text: "ready" }],
      }));
      server.setRequestHandler("prompts/list", async () => ({
        prompts: [{ name: "inspect", arguments: [{ name: "subject" }] }],
      }));
      server.setRequestHandler("prompts/get", async ({ params }) => ({
        messages: [
          { role: "user", content: { type: "text", text: `inspect ${params.arguments?.subject ?? "state"}` } },
        ],
      }));
      return server;
    },
    { legacy: "reject" },
  );
}
