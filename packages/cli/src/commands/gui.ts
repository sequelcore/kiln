import { exec } from "node:child_process";
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
  readonly cwd?: string;
  readonly open?: boolean;
}

export async function guiCommand(appConfig: KilnAppConfig, flags: GuiFlags = {}): Promise<void> {
  const cwd = flags.cwd ?? process.cwd();
  const port = flags.port ?? 4810;
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

  console.log(`GUI gateway started on ${gateway.url}`);
  console.log(`Dashboard API: ${gateway.apiUrl}`);
  if (!gateway.hasMountedGui) {
    console.log("GUI bundle not built; use `bun run dev` in packages/gui for the interactive client.");
  }

  if (flags.open ?? true) {
    openBrowser(gateway.url);
  }

  await waitForShutdown(() => gateway.shutdown());
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
  const sessions = (await sessionStore.list()).slice(0, 20).map((session) => ({
    id: session.sessionId,
    provider: session.provider,
    title: buildSessionTitle(session.task, session.provider),
    updatedAt: session.completedAt,
    costUsd: session.cost,
  }));

  const providerHealth = new Map(
    registry.list().map((provider) => [provider.id, provider.health !== "suppressed"] as const),
  );

  const providerDescriptors: GuiProviderDescriptor[] = providers.map((provider) => ({
    id: provider.id,
    label: toProviderLabel(provider.id),
    group: normalizeProviderGroup(provider.group),
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

function normalizeProviderGroup(group: string): GuiProviderDescriptor["group"] {
  if (group === "direct-api") {
    return "direct";
  }
  return group as GuiProviderDescriptor["group"];
}

function buildSessionTitle(task: string, provider: string): string {
  if (task.trim().length > 0) {
    return task;
  }
  return `${toProviderLabel(provider)} session`;
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

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, (error) => {
    if (error) {
      console.error(`Could not open browser: ${error.message}`);
    }
  });
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

async function waitForShutdown(onShutdown: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      onShutdown();
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
