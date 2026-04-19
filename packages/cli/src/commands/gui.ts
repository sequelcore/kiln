import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { readGlobalConfig } from "../config/global-config.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import {
  createDefaultRegistry,
  getProviderDisplayInfo,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { makeMultiProviderSessionFactory } from "./tui.js";
import {
  getProjectContextArtifactCache,
  type GuiDashboardSnapshot,
  type GuiSessionDetail,
  type GuiProviderDescriptor,
} from "@kilnai/runtime";
import { getFieldStore } from "@kilnai/core";

export interface GuiFlags {
  readonly port?: number;
  readonly guiPort?: number;
  readonly mode?: "dev" | "prod";
  readonly cwd?: string;
  readonly open?: boolean;
}

export async function guiCommand(appConfig: KilnAppConfig, flags: GuiFlags = {}): Promise<void> {
  const cwd = flags.cwd ?? process.cwd();
  const mode = resolveGuiMode(cwd, flags.mode);
  const port = flags.port ?? 4810;
  const guiPort = flags.guiPort ?? 5183;
  const sessionStore = new SessionStore(cwd);
  const { registry } = createDefaultRegistry();
  const providerDisplay = getProviderDisplayInfo(registry);
  const providerIds = providerDisplay.map((provider) => provider.id);
  const globalConfig = readGlobalConfig();
  const provider = parseProvider(resolveEffectiveProvider(undefined, globalConfig?.provider), providerIds);
  const transcriptStore = new TranscriptStore(cwd);
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
    providerIds,
    cwd,
    registry,
    sessionStore,
    transcriptStore,
    contextArtifactCache,
  );
  const systemPrompt = await resolveGuiSystemPrompt(appConfig, cwd, contextArtifactCache);

  const { startGuiGateway } = await import("@kilnai/runtime");
  const gateway = await startGuiGateway({
    port,
    getSnapshot: async () => buildDashboardSnapshot(sessionStore, providerDisplay),
    listSessions: (providerId) => loadSessionSummaries(sessionStore, providerId),
    getSessionDetail: (sessionId) => loadSessionDetail(transcriptStore, sessionId),
    operatorTransport: {
      sessionManager,
      systemPrompt,
      onClear: sessionManager.onClear,
      onResumeSession: (sessionId, providerId) => {
        sessionManager.setProvider(providerId);
        sessionManager.setResumeSession(sessionId, providerId);
      },
      contextArtifactCache,
      planMode: false,
    },
  });

  let viteDevChild: ChildProcess | undefined;
  if (mode === "dev") {
    viteDevChild = spawnGuiDevServer(cwd, guiPort, gateway.port);
  }

  const gatewayUrl = `http://localhost:${gateway.port}/gui/`;
  const guiUrl = mode === "dev" ? `http://localhost:${guiPort}/` : gatewayUrl;
  printStartupBanner({ mode, gatewayUrl, guiUrl, apiUrl: gateway.apiUrl });

  if (flags.open ?? true) {
    openBrowser(guiUrl);
  }

  await waitForShutdown(async () => {
    if (viteDevChild) {
      await stopChildProcess(viteDevChild, "gui-dev");
    }
    gateway.shutdown();
  });
}

function parseProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId {
  if (p && providerIds.includes(p as ProviderId)) {
    return p as ProviderId;
  }
  return providerIds.includes("claude") ? "claude" : providerIds[0] ?? "claude";
}

async function resolveGuiSystemPrompt(
  appConfig: KilnAppConfig,
  cwd: string,
  contextArtifactCache: Awaited<ReturnType<typeof getProjectContextArtifactCache>>,
): Promise<string> {
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = {
      mode: "cli-wrapper" as const,
      permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const },
    };
    const manager = new SessionManager(wrapperConfig, appConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    return context.systemPrompt;
  } catch {
    return "You are a helpful assistant.";
  }
}

async function buildDashboardSnapshot(
  sessionStore: SessionStore,
  providers: readonly ReturnType<typeof getProviderDisplayInfo>[number][],
): Promise<GuiDashboardSnapshot> {
  const { registry } = createDefaultRegistry();
  const sessions = await loadSessionSummaries(sessionStore);

  const providerHealth = new Map(
    registry.list().map((provider) => [provider.id, provider.health !== "suppressed"] as const),
  );

  const providerDescriptors: GuiProviderDescriptor[] = providers.map((provider) => ({
    id: provider.id,
    label: toProviderLabel(provider.id),
    group: provider.group,
    models: provider.models,
    free: provider.free,
    available: providerHealth.get(provider.id) ?? true,
  }));

  const telemetry = await readTelemetrySnapshot();

  return {
    providers: providerDescriptors,
    sessions,
    telemetry,
  };
}

async function loadSessionDetail(transcriptStore: TranscriptStore, sessionId: string): Promise<GuiSessionDetail | null> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const [meta, transcript] = await Promise.all([
    transcriptStore.readMeta(normalizedSessionId),
    transcriptStore.readTranscript(normalizedSessionId),
  ]);
  if (!meta) {
    return null;
  }
  return {
    id: normalizedSessionId,
    meta,
    transcript,
  };
}

function buildSessionTitle(task: string | undefined, provider: string): string {
  if (task && task.trim().length > 0) {
    return task;
  }
  return `${toProviderLabel(provider)} session`;
}

async function loadSessionSummaries(
  sessionStore: SessionStore,
  provider?: string,
): Promise<GuiDashboardSnapshot["sessions"]> {
  const sessions = await sessionStore.list();
  return sessions
    .filter((session) => !provider || session.provider === provider)
    .slice(0, 20)
    .map((session) => ({
      id: session.sessionId,
      provider: session.provider,
      completedAt: session.completedAt,
      cost: session.cost,
      taskSummary: buildSessionTitle(session.task, session.provider),
    }));
}

function toProviderLabel(provider: string): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "codex-oauth":
      return "Codex OAuth";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "deepseek":
      return "DeepSeek";
    case "ollama":
      return "Ollama";
    case "anthropic":
      return "Anthropic";
    default:
      return provider;
  }
}

function resolveGuiMode(cwd: string, explicitMode: GuiFlags["mode"]): "dev" | "prod" {
  if (explicitMode) {
    return explicitMode;
  }
  const distIndexPath = join(cwd, "packages", "gui", "dist", "index.html");
  return existsSync(distIndexPath) ? "prod" : "dev";
}

function spawnGuiDevServer(cwd: string, guiPort: number, gatewayPort: number): ChildProcess {
  const guiWorkspacePath = join(cwd, "packages", "gui");
  if (!existsSync(join(guiWorkspacePath, "package.json"))) {
    throw new Error(`GUI workspace not found at ${guiWorkspacePath}`);
  }

  const child = spawn("bun", ["run", "--cwd", "packages/gui", "dev", "--", "--port", String(guiPort)], {
    cwd,
    env: {
      ...process.env,
      GUI_PORT: String(guiPort),
      GUI_GATEWAY_PORT: String(gatewayPort),
      VITE_GATEWAY_PORT: String(gatewayPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer | string) => {
    writePrefixed("gui-dev", chunk, process.stdout);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    writePrefixed("gui-dev", chunk, process.stderr);
  });
  child.on("error", (error) => {
    console.error(`[gui-dev] Failed to start: ${error.message}`);
  });

  return child;
}

function writePrefixed(prefix: string, chunk: Buffer | string, output: NodeJS.WriteStream): void {
  const text = chunk.toString();
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isLastEmptyLine = index === lines.length - 1 && line.length === 0;
    if (isLastEmptyLine) {
      continue;
    }
    output.write(`[${prefix}] ${line}\n`);
  }
}

async function stopChildProcess(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
    child.once("exit", finish);
    if (!child.kill("SIGINT")) {
      child.kill("SIGTERM");
    }
  });
  console.log(`[${label}] stopped`);
}

function printStartupBanner(input: { mode: "dev" | "prod"; gatewayUrl: string; guiUrl: string; apiUrl: string }): void {
  console.log("Kiln GUI");
  console.log(`Mode: ${input.mode}`);
  console.log(`Gateway URL: ${input.gatewayUrl}`);
  console.log(`GUI URL: ${input.guiUrl}`);
  console.log(`Dashboard API: ${input.apiUrl}`);
}

function openBrowser(url: string): void {
  const command = process.platform === "win32"
    ? "cmd"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", url]
    : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error(`Could not open browser: ${error.message}`);
  });
  child.unref();
}

async function readTelemetrySnapshot(): Promise<GuiDashboardSnapshot["telemetry"]> {
  try {
    const snapshot = await getFieldStore().snapshot();
    const regions = [...snapshot.regions.values()];
    const saturation = regions.length > 0
      ? regions.reduce((sum, region) => sum + region.value, 0) / regions.length
      : 0;

    return {
      status: regions.length === 0 ? "idle" : "stable",
      dominantRegions: snapshot.dominantRegions.slice(0, 3),
      saturation,
      entropy: snapshot.entropy,
    };
  } catch {
    return {
      status: "idle",
      dominantRegions: [],
      saturation: 0,
      entropy: 0,
    };
  }
}

async function waitForShutdown(onShutdown: () => Promise<void> | void): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      Promise.resolve(onShutdown()).finally(resolve);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
