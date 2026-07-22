import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayConfig } from "../packages/core/src/engine/gateway/gateway-config.js";
import { buildCodexResponsesProjection, buildOpenCodeResponsesProjection } from "../packages/cli/src/config/model-gateway-native-projection.js";

const TOKEN = "synthetic-live-probe-token-0000000000000000";
const TIMEOUT_MS = 45_000;

interface ObservedRequest {
  readonly path: string;
  readonly authorization: string | null;
  readonly sessionId: string | null;
  readonly sessionAffinity: string | null;
  readonly body: Record<string, unknown>;
}

let activeObserved: ObservedRequest[] | undefined;

const root = await mkdtemp(join(tmpdir(), "kiln-responses-harness-live-"));
try {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => probeResponse(request),
  });
  try {
    if (server.port === undefined) throw new Error("Synthetic loopback server did not bind a port.");
    const config = gatewayConfig(server.port);
    await probeCodex(config);
    await probeOpenCode(config);
    process.stdout.write("Codex and OpenCode Responses harness probes passed.\n");
  } finally {
    server.stop(true);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

async function probeResponse(request: Request): Promise<Response> {
  if (!activeObserved) return new Response("probe is not active", { status: 503 });
  if (request.method !== "POST") return new Response("not found", { status: 404 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(await request.text()) as Record<string, unknown>; }
  catch { return new Response("invalid request", { status: 400 }); }
  activeObserved.push({
    path: new URL(request.url).pathname,
    authorization: request.headers.get("authorization"),
    sessionId: request.headers.get("x-session-id") ?? request.headers.get("session-id"),
    sessionAffinity: request.headers.get("x-session-affinity"),
    body,
  });
  const responseId = "resp_kiln_probe";
  const item = { type: "message", id: "msg_kiln_probe", role: "assistant", status: "completed", content: [{ type: "output_text", text: "PROBE_OK", annotations: [] }] };
  const completed = { id: responseId, object: "response", created_at: 1, status: "completed", model: String(body.model ?? "model-a"), output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const events = [
    ["response.created", { type: "response.created", response: { ...completed, status: "in_progress", output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } }],
    ["response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "PROBE_OK" }],
    ["response.output_text.done", { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: "PROBE_OK" }],
    ["response.content_part.done", { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response: completed }],
  ];
  return new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

async function probeCodex(config: ModelGatewayConfig): Promise<void> {
  const executable = Bun.which("codex");
  if (!executable) throw new Error("codex is not installed; the explicit live probe requires it.");
  const home = join(root, "codex-home");
  const workspace = join(root, "codex-workspace");
  const catalogPath = join(home, "kiln-models.json");
  await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true });
  const projection = buildCodexResponsesProjection({ config, modelCatalogPath: catalogPath });
  if (!projection) throw new Error("Codex projection was not configured.");
  await writeFile(join(home, "config.toml"), serializeCodexProbeProjection(projection.patch), "utf8");
  await writeFile(catalogPath, `${JSON.stringify(projection.catalog, null, 2)}\n`, "utf8");
  const outputPath = join(home, "last-message.txt");
  activeObserved = [];
  const result = await runBounded(executable, ["exec", "--strict-config", "--ephemeral", "--ignore-rules", "--skip-git-repo-check", "--color", "never", "--output-last-message", outputPath, "Return exactly PROBE_OK and do not call tools."], workspace, {
    CODEX_HOME: home,
    CODEX_GATEWAY_TOKEN: TOKEN,
  });
  const lastMessage = await readFile(outputPath, "utf8").catch(() => "");
  assertProbe("Codex", result, `${result.stdout}\n${lastMessage}`, activeObserved, false);
  activeObserved = undefined;
}

async function probeOpenCode(config: ModelGatewayConfig): Promise<void> {
  const executable = Bun.which("opencode");
  if (!executable) throw new Error("opencode is not installed; the explicit live probe requires it.");
  const home = join(root, "opencode-home");
  const configRoot = join(root, "opencode-config");
  const configDir = join(configRoot, "opencode");
  const data = join(root, "opencode-data");
  const cache = join(root, "opencode-cache");
  const state = join(root, "opencode-state");
  const workspace = join(root, "opencode-workspace");
  const managed = join(root, "opencode-managed");
  await Promise.all([home, configDir, data, cache, state, workspace, managed].map((path) => mkdir(path, { recursive: true })));
  const projection = buildOpenCodeResponsesProjection({ config });
  if (!projection) throw new Error("OpenCode projection was not configured.");
  await writeFile(join(configDir, "opencode.json"), `${JSON.stringify(projection.patch, null, 2)}\n`, "utf8");
  activeObserved = [];
  const result = await runBounded(executable, ["run", "--pure", "--format", "default", "--title", "Kiln probe", "--model", "kiln/model-a", "--dir", workspace, "Return exactly PROBE_OK and do not call tools."], workspace, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: configRoot,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    XDG_STATE_HOME: state,
    OPENCODE_TEST_HOME: home,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: managed,
    OPENCODE_AUTH_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_DEFAULT_SKILLS: "1",
    OPENCODE_GATEWAY_TOKEN: TOKEN,
    TEMP: join(root, "temp"),
    TMP: join(root, "temp"),
  });
  assertProbe("OpenCode", result, result.stdout, activeObserved, true);
  activeObserved = undefined;
}

function assertProbe(harness: string, result: ProcessResult, output: string, observed: readonly ObservedRequest[], requireOpenCodeHeaders: boolean): void {
  if (result.exitCode !== 0) throw new Error(`${harness} exited ${result.exitCode}: ${redact(result.stderr || result.stdout)}`);
  if (!output.includes("PROBE_OK")) throw new Error(`${harness} did not return PROBE_OK: ${redact(output)}`);
  if (observed.length !== 1) throw new Error(`${harness} made ${observed.length} model POSTs; expected exactly one.`);
  const request = observed[0]!;
  if (request.path !== "/v1/responses") throw new Error(`${harness} used unexpected path '${request.path}'.`);
  if (request.authorization !== `Bearer ${TOKEN}`) throw new Error(`${harness} did not use the projected bearer environment variable.`);
  if (request.body.model !== "model-a") throw new Error(`${harness} did not use the projected virtual model.`);
  if (harness === "Codex") {
    if (request.body.instructions !== "You are a governed Kiln probe.") throw new Error("Codex did not project canonical model instructions.");
    if (!Array.isArray(request.body.input) || !Array.isArray(request.body.tools)) throw new Error("Codex did not emit the expected Responses input/tools shape.");
  }
  if (!request.sessionId) throw new Error(`${harness} omitted stable session correlation.`);
  if (requireOpenCodeHeaders && !request.sessionAffinity) throw new Error("OpenCode omitted x-session-affinity correlation.");
  if (requireOpenCodeHeaders && request.sessionAffinity !== request.sessionId) throw new Error("OpenCode emitted contradictory session correlation headers.");
}

interface ProcessResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }

async function runBounded(executable: string, args: readonly string[], cwd: string, extraEnv: Record<string, string>): Promise<ProcessResult> {
  const child = spawn(executable, [...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void killTree(child.pid); }, TIMEOUT_MS);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("exit", resolve);
  }).finally(() => clearTimeout(timer));
  if (timedOut) throw new Error(`Harness process exceeded ${TIMEOUT_MS}ms.`);
  return { exitCode, stdout, stderr };
}

async function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("exit", () => resolve()); killer.once("error", () => resolve());
    });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ }
  }
}

function redact(value: string): string {
  return value.replaceAll(TOKEN, "[REDACTED]").slice(0, 4_000);
}

function serializeCodexProbeProjection(patch: Record<string, unknown>): string {
  const providers = patch.model_providers as Record<string, Record<string, unknown>> | undefined;
  const provider = providers?.kiln;
  if (!provider) throw new Error("Codex probe projection omitted model_providers.kiln.");
  const line = (key: string, value: unknown) => `${key} = ${typeof value === "string" ? JSON.stringify(value) : String(value)}\n`;
  return [
    line("model", patch.model),
    line("model_provider", patch.model_provider),
    line("model_catalog_json", patch.model_catalog_json),
    "\n[model_providers.kiln]\n",
    ...["name", "base_url", "env_key", "requires_openai_auth", "wire_api", "request_max_retries", "stream_max_retries", "supports_websockets"]
      .map((key) => line(key, provider[key])),
  ].join("");
}

function gatewayConfig(port: number): ModelGatewayConfig {
  const principal = (nativeHarness: "codex" | "opencode", tokenEnv: string) => ({
    tokenEnv, ingress: "openai-responses" as const, tenantId: "probe", applicationId: nativeHarness, callerId: "live", capabilityId: "invoke",
    scopes: ["model.invoke"], budgetEvidenceId: "synthetic", virtualModelIds: ["model-a"], nativeHarness,
  } as const);
  return {
    port,
    accounts: [{ id: "unused", providerId: "codex-oauth", credentialId: "unused", maxConcurrency: 1, reservedAffinitySlots: 0 }],
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "UNUSED" },
    surfaces: { openAIResponses: { maxBodyBytes: 1024 * 1024, maxConcurrentRequests: 2 } },
    principals: [principal("codex", "CODEX_GATEWAY_TOKEN"), principal("opencode", "OPENCODE_GATEWAY_TOKEN")],
    virtualModels: [{ id: "model-a", displayName: "Kiln Probe", contextTokens: 100000, outputTokens: 4096, baseInstructions: "You are a governed Kiln probe.", providerId: "codex-oauth", providerModelId: "unused", accountIds: ["unused"], capabilities: ["text"], affinity: { continuity: "none" } }],
  };
}
