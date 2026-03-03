import { startGateway } from "@kilnai/runtime";
import { join } from "node:path";

// Start MCP tools server
const toolsProc = Bun.spawn(["bun", "run", join(import.meta.dir, "tools-server.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

// Wait for tools server to be ready
const toolsUrl = "http://localhost:3100/mcp";
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(toolsUrl);
    if (res.ok) break;
  } catch {
    // Not ready yet
  }
  await new Promise((r) => setTimeout(r, 200));
}

// Start gateway (auto-discovers MCP tools)
await startGateway(join(import.meta.dir, "gateway.yaml"));

// Clean up on exit
process.on("SIGINT", () => {
  toolsProc.kill();
  process.exit(0);
});
