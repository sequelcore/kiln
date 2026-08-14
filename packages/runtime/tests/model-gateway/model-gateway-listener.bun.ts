import { strict as assert } from "node:assert";
import { ownModelGatewayRequestLifetime } from "../../src/model-gateway/model-gateway-listener.js";
import { claimModelGatewayRequestLifetime } from "../../src/model-gateway/model-gateway-request-lifetime.js";

let admitRequest!: () => void;
const requestAdmitted = new Promise<void>((resolve) => { admitRequest = resolve; });
let finishRequest!: () => void;
const requestMayFinish = new Promise<void>((resolve) => { finishRequest = resolve; });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 1,
  fetch: ownModelGatewayRequestLifetime(async (request) => {
    claimModelGatewayRequestLifetime(request);
    admitRequest();
    await requestMayFinish;
    return new Response("completed");
  }),
});

try {
  const responsePending = fetch(`http://127.0.0.1:${server.port}/quiet`);
  await requestAdmitted;

  let stopped = false;
  const stopPending = server.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false, "Graceful stop must wait for an admitted request.");

  finishRequest();
  const response = await responsePending;
  if (response.status !== 200) throw new Error(`Expected status 200, received ${response.status}.`);
  const body = await response.text();
  if (body !== "completed") throw new Error(`Expected completed response, received '${body}'.`);
  await stopPending;
  assert.equal(stopped, true, "Graceful stop must settle after the admitted request completes.");
} finally {
  finishRequest();
  await server.stop();
}
