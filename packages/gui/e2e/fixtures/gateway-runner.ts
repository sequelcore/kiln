import { startGuiGateway } from "@kilnai/runtime";

function parseGatewayPort(): number {
  const raw = process.env.GUI_GATEWAY_PORT ?? "4810";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid GUI_GATEWAY_PORT: ${raw}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const port = parseGatewayPort();
  const gateway = await startGuiGateway({
    port,
    getSnapshot: async () => ({
      providers: [],
      sessions: [],
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
    }),
  });

  process.stdout.write(`READY ${gateway.port}\n`);

  const shutdown = () => {
    gateway.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway runner failed: ${message}\n`);
  process.exit(1);
});
