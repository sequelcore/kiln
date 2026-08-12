import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayConfig } from "../packages/core/src/engine/gateway/gateway-config.js";
import { buildClaudeMessagesProjection, buildCodexResponsesProjection, buildOpenCodeResponsesProjection } from "../packages/cli/src/config/model-gateway-native-projection.js";

const TOKEN = "synthetic-live-probe-token-0000000000000000";
const TIMEOUT_MS = 45_000;

interface ObservedRequest {
  readonly path: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly apiKey: string | null;
  readonly anthropicVersion: string | null;
  readonly sessionId: string | null;
  readonly sessionAffinity: string | null;
  readonly body: Record<string, unknown>;
}

let activeObserved: ObservedRequest[] | undefined;

const root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-harness-live-"));
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
    await probeClaude(config);
    process.stdout.write("Codex, OpenCode, and Claude model-gateway harness probes passed.\n");
  } finally {
    server.stop(true);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

async function probeResponse(request: Request): Promise<Response> {
  if (!activeObserved) return new Response("probe is not active", { status: 503 });
  const url = new URL(request.url);
  if (request.method === "HEAD") return new Response(null, { status: 200 });
  if (request.method !== "POST") return new Response("not found", { status: 404 });
  if (url.pathname === "/v1/messages/count_tokens") return new Response("not found", { status: 404 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(await request.text()) as Record<string, unknown>; }
  catch { return new Response("invalid request", { status: 400 }); }
  activeObserved.push({
    path: `${url.pathname}${url.search}`,
    method: request.method,
    authorization: request.headers.get("authorization"),
    apiKey: request.headers.get("x-api-key"),
    anthropicVersion: request.headers.get("anthropic-version"),
    sessionId: request.headers.get("x-claude-code-session-id") ?? request.headers.get("x-session-id") ?? request.headers.get("session-id"),
    sessionAffinity: request.headers.get("x-session-affinity"),
    body,
  });
  if (url.pathname === "/v1/messages") return anthropicProbeResponse(body);
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

function anthropicProbeResponse(body: Record<string, unknown>): Response {
  const messageId = "msg_kiln_probe";
  const model = String(body.model ?? "claude-kiln-probe");
  const events = [
    { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PROBE_OK" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

async function probeCodex(config: ModelGatewayConfig): Promise<void> {
  const executable = Bun.which("codex");
  if (!executable) throw new Error("codex is not installed; the explicit live probe requires it.");
  const home = join(root, "codex-home");
  const workspace = join(root, "codex-workspace");
  await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true });
  const projection = buildCodexResponsesProjection({ config });
  if (!projection) throw new Error("Codex projection was not configured.");
  await writeFile(join(home, "config.toml"), serializeCodexProbeProjection(projection.patch), "utf8");
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

async function probeClaude(config: ModelGatewayConfig): Promise<void> {
  const executable = Bun.which("claude");
  if (!executable) throw new Error("claude is not installed; the explicit live probe requires it.");
  const configDir = join(root, "claude-config");
  const home = join(root, "claude-home");
  const workspace = join(root, "claude-workspace");
  const temporary = join(root, "claude-temp");
  await Promise.all([configDir, home, join(workspace, ".claude"), temporary].map((path) => mkdir(path, { recursive: true })));
  const projection = buildClaudeMessagesProjection({ config });
  if (!projection) throw new Error("Claude projection was not configured.");
  await writeFile(join(workspace, ".claude", "settings.json"), `${JSON.stringify(projection.patch, null, 2)}\n`, "utf8");
  activeObserved = [];
  const sessionId = randomUUID();
  const result = await runBounded(executable, [
    "--bare",
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "",
    "--permission-mode", "dontAsk",
    "--model", "claude-kiln-probe",
    "--session-id", sessionId,
    "--system-prompt", "Reply exactly PROBE_OK.",
    "Return exactly PROBE_OK.",
  ], workspace, {
    CLAUDE_CONFIG_DIR: configDir,
    HOME: home,
    USERPROFILE: home,
    TEMP: temporary,
    TMP: temporary,
    CLAUDE_CODE_TMPDIR: temporary,
    ANTHROPIC_AUTH_TOKEN: TOKEN,
    ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-kiln-probe",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    DISABLE_AUTOUPDATER: "1",
  }, ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);
  assertClaudeProbe(result, activeObserved, sessionId);
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
    if (typeof request.body.instructions !== "string" || request.body.instructions.length === 0) throw new Error("Codex omitted its native instructions.");
    if (!Array.isArray(request.body.input) || !Array.isArray(request.body.tools)) throw new Error("Codex did not emit the expected Responses input/tools shape.");
  }
  if (!request.sessionId) throw new Error(`${harness} omitted stable session correlation.`);
  if (requireOpenCodeHeaders && !request.sessionAffinity) throw new Error("OpenCode omitted x-session-affinity correlation.");
  if (requireOpenCodeHeaders && request.sessionAffinity !== request.sessionId) throw new Error("OpenCode emitted contradictory session correlation headers.");
}

function assertClaudeProbe(result: ProcessResult, observed: readonly ObservedRequest[], sessionId: string): void {
  if (result.exitCode !== 0) throw new Error(`Claude exited ${result.exitCode}: ${redact(result.stderr || result.stdout)}`);
  if (!result.stdout.includes("PROBE_OK")) throw new Error(`Claude did not return PROBE_OK: ${redact(result.stdout)}`);
  if (observed.length !== 1) throw new Error(`Claude made ${observed.length} model POSTs; expected exactly one.`);
  const request = observed[0]!;
  if (request.method !== "POST" || new URL(request.path, "http://127.0.0.1").pathname !== "/v1/messages") throw new Error(`Claude used unexpected request '${request.method} ${request.path}'.`);
  if (request.authorization !== `Bearer ${TOKEN}`) throw new Error("Claude did not use the projected bearer environment variable.");
  if (request.apiKey !== null) throw new Error("Claude sent x-api-key despite ANTHROPIC_AUTH_TOKEN bearer projection.");
  if (request.anthropicVersion !== "2023-06-01") throw new Error(`Claude sent unexpected anthropic-version '${request.anthropicVersion}'.`);
  if (request.sessionId !== sessionId) throw new Error("Claude omitted or changed x-claude-code-session-id correlation.");
  if (request.body.model !== "claude-kiln-probe") throw new Error("Claude did not use the projected virtual model.");
  if (request.body.stream !== true) throw new Error("Claude did not request the mandatory Messages SSE stream.");
  if (typeof request.body.max_tokens !== "number" || request.body.max_tokens <= 0) throw new Error("Claude omitted a positive max_tokens bound.");
  for (const unsupported of ["thinking", "context_management"] as const) {
    if (unsupported in request.body) throw new Error(`Claude emitted unsupported Messages field '${unsupported}'.`);
  }
  const outputConfig = request.body.output_config;
  if (!isRecord(outputConfig) || Object.keys(outputConfig).length !== 1 || outputConfig.effort !== "high") {
    throw new Error("Claude emitted an unsupported output_config shape.");
  }
  if (JSON.stringify(request.body).includes('"cache_control"')) throw new Error("Claude emitted unsupported prompt cache controls.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ProcessResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }

async function runBounded(executable: string, args: readonly string[], cwd: string, extraEnv: Record<string, string>, unsetEnv: readonly string[] = []): Promise<ProcessResult> {
  const env = { ...process.env, ...extraEnv };
  for (const key of unsetEnv) delete env[key];
  const child = spawn(executable, [...args], {
    cwd,
    env,
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
    line("model", "model-a"),
    line("model_provider", "kiln"),
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
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "UNUSED" },
    surfaces: {
      openAIResponses: { maxBodyBytes: 1024 * 1024, maxConcurrentRequests: 2 },
      anthropicMessages: { maxBodyBytes: 1024 * 1024, maxConcurrentRequests: 2 },
    },
    principals: [
      principal("codex", "CODEX_GATEWAY_TOKEN"),
      principal("opencode", "OPENCODE_GATEWAY_TOKEN"),
      {
        tokenEnv: "ANTHROPIC_AUTH_TOKEN", ingress: "anthropic-messages", tenantId: "probe", applicationId: "claude", callerId: "live", capabilityId: "invoke",
        scopes: ["model.invoke"], budgetEvidenceId: "synthetic", virtualModelIds: ["claude-kiln-probe"], nativeHarness: "claude",
      },
    ],
    virtualModels: [
      { id: "model-a", displayName: "Kiln Probe", contextTokens: 100000, outputTokens: 4096, baseInstructions: "You are a governed Kiln probe.", executionRouteId: "model-a", capabilities: ["text"], affinity: { continuity: "none" } },
      { id: "claude-kiln-probe", displayName: "Kiln Claude Probe", contextTokens: 100000, outputTokens: 4096, executionRouteId: "claude-kiln-probe", capabilities: ["text"], affinity: { continuity: "none" } },
    ],
  };
}
