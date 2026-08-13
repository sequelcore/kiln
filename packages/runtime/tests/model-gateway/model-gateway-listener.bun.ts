import { ownModelGatewayRequestLifetime } from "../../src/model-gateway/model-gateway-listener.js";
import { claimModelGatewayRequestLifetime } from "../../src/model-gateway/model-gateway-request-lifetime.js";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 1,
  fetch: ownModelGatewayRequestLifetime(async (request) => {
    claimModelGatewayRequestLifetime(request);
    await Bun.sleep(1_500);
    return new Response("completed");
  }),
});

try {
  const response = await fetch(`http://127.0.0.1:${server.port}/quiet`);
  if (response.status !== 200) throw new Error(`Expected status 200, received ${response.status}.`);
  const body = await response.text();
  if (body !== "completed") throw new Error(`Expected completed response, received '${body}'.`);
} finally {
  await server.stop(true);
}
