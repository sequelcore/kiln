import { Server } from "../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

if (process.argv.includes("--malformed")) {
  process.stdout.write("this is not json-rpc\n");
  setInterval(() => undefined, 1_000);
} else {
  const server = new Server(
    { name: "kiln-fixture", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "echo", description: "Fixture echo", inputSchema: { type: "object" } },
      { name: "wait", description: "Fixture wait", inputSchema: { type: "object" } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    if (params.name === "wait") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 60_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("cancelled"));
        }, { once: true });
      });
    }
    return { content: [{ type: "text", text: JSON.stringify(params.arguments ?? {}) }] };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: "fixture://state", name: "state", mimeType: "text/plain" }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async () => ({
    contents: [{ uri: "fixture://state", text: "ready" }],
  }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "inspect", arguments: [{ name: "subject" }] }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => ({
    messages: [{ role: "user", content: { type: "text", text: `inspect ${params.arguments?.subject ?? "state"}` } }],
  }));
  await server.connect(new StdioServerTransport());
}
