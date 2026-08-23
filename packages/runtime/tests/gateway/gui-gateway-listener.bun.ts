import { networkInterfaces } from "node:os";
import { startGuiGateway } from "../../src/gateway/gui-gateway.js";

const gateway = await startGuiGateway({
  port: 0,
  guiAssetMode: "external",
  getSnapshot: async () => ({}) as never,
});

try {
  const canonicalOrigin = new URL(gateway.url).origin;
  if (!canonicalOrigin.startsWith("http://127.0.0.1:")) {
    throw new Error(`GUI gateway advertised a non-loopback origin: ${canonicalOrigin}`);
  }

  const health = await fetch(`${canonicalOrigin}/health`, {
    headers: { origin: canonicalOrigin },
  });
  if (!health.ok || health.headers.get("access-control-allow-origin") !== canonicalOrigin) {
    throw new Error("GUI gateway did not admit its exact bound browser origin.");
  }

  const rejected = await fetch(`${canonicalOrigin}/health`, {
    headers: { origin: "https://attacker.invalid" },
  });
  if (rejected.status !== 403 || rejected.headers.has("access-control-allow-origin")) {
    throw new Error("GUI gateway admitted an unexpected browser origin.");
  }

  for (const address of nonLoopbackIpv4Addresses()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 750);
    try {
      const response = await fetch(`http://${address}:${gateway.port}/health`, {
        signal: controller.signal,
      });
      throw new Error(
        `GUI gateway was reachable through non-loopback address ${address} with status ${response.status}.`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("GUI gateway was reachable")) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
} finally {
  gateway.shutdown();
}

function nonLoopbackIpv4Addresses(): readonly string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}
