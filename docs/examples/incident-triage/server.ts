import { startGateway } from "@kilnai/runtime";
import { join } from "node:path";

const toolsProc = Bun.spawn(["bun", "run", join(import.meta.dir, "tools-server.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

const toolsUrl = "http://localhost:3500/health";
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(toolsUrl);
    if (res.ok) break;
  } catch {
    // Tool server is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

await startGateway(join(import.meta.dir, "gateway.yaml"));

process.on("SIGINT", () => {
  toolsProc.kill();
  process.exit(0);
});
