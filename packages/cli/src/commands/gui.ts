import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { readGlobalConfig } from "../config/global-config.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { loadResumeSidebarInfo } from "../application/resume-sidebar-info.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import { loadSessionDetail } from "./gui-session-detail.js";
import {
  createDefaultRegistry,
  getRuntimeProviderAvailability,
  getProviderDisplayInfo,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { makeMultiProviderSessionFactory } from "./tui.js";
import {
  getProjectContextArtifactCache,
  type GuiDashboardSnapshot,
  type GuiProviderDescriptor,
} from "@kilnai/runtime";
import { createSessionBuiltinToolOptions, getFieldStore } from "@kilnai/core";
import { persistGuiThemePreference, resolveGuiThemePreference } from "../application/operator-theme-preferences.js";
import { buildGuiAttachUrl, buildGuiUrl } from "./gui-options.js";
import { createLocalWorkspaceExplorer } from "./gui-workspace.js";
import { createManagedGuiWindowShutdownMonitor } from "./gui-shutdown-monitor.js";
import { launchGuiWindow, type GuiWindowSession } from "./gui-window.js";
import { loadSessionSummaries, toProviderLabel } from "./gui-session-summaries.js";
import { isGuiProviderModeless, type GuiProviderDiscoveryResult } from "@kilnai/gateway-contracts";
import type { OperatorWorkspaceExplorer } from "@kilnai/gateway-contracts";

export interface GuiFlags {
  readonly port?: number;
  readonly guiPort?: number;
  readonly mode?: "dev" | "prod";
  readonly cwd?: string;
  readonly connect?: string;
  readonly open?: boolean;
  readonly provider?: string;
  readonly theme?: string;
  readonly plan?: boolean;
}

export async function guiCommand(appConfig: KilnAppConfig, flags: GuiFlags = {}): Promise<void> {
  const cwd = flags.cwd ?? process.cwd();
  const globalConfig = readGlobalConfig();
  const themePreference = resolveGuiThemePreference(flags.theme, globalConfig);
  if (flags.connect) {
    await guiAttachCommand(flags.connect, themePreference, flags);
    return;
  }

  const mode = resolveGuiMode(cwd, flags.mode);
  const port = flags.port ?? 4810;
  const guiPort = flags.guiPort ?? 5183;
  const sessionStore = new SessionStore(cwd);
  const { registry } = createDefaultRegistry();
  const providerDisplay = getProviderDisplayInfo(registry);
  const providerIds = providerDisplay.map((provider) => provider.id);
  const provider = parseProvider(resolveEffectiveProvider(flags.provider, globalConfig?.provider), providerIds);
  const transcriptStore = new TranscriptStore(cwd);
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  const builtinToolOptions = createSessionBuiltinToolOptions(
    await loadConfiguredWebToolSurfaceOptions(appConfig, cwd),
  );
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
    providerIds,
    cwd,
    registry,
    sessionStore,
    transcriptStore,
    contextArtifactCache,
    builtinToolOptions,
    "gui",
  );
  const bootstrapContext = await resolveGuiBootstrapContext(appConfig, cwd, contextArtifactCache);
  const managedWindowShutdownMonitor = createManagedGuiWindowShutdownMonitor();
  const workspaceExplorer = createLocalWorkspaceExplorer(cwd);
  const { startGuiGateway } = await import("@kilnai/runtime");
  const gateway = await startGuiGateway({
    port,
    getProviderAvailability: () => getRuntimeProviderAvailability(registry),
    getSnapshot: async (context) => buildDashboardSnapshot(
      registry,
      sessionStore,
      transcriptStore,
      providerDisplay,
      context?.operatorModels ?? {},
      context?.operatorDiscovery ?? [],
      cwd,
      bootstrapContext.domainLabel,
      workspaceExplorer,
    ),
    listSessions: () => loadSessionSummaries(sessionStore, transcriptStore),
    getSessionDetail: (sessionId) => loadSessionDetail(transcriptStore, sessionId),
    workingDirectory: cwd,
    domainLabel: bootstrapContext.domainLabel,
    workspaceExplorer,
    updateThemePreference: (theme) => persistGuiThemePreference(theme, globalConfig),
    onConnectionCountChange: managedWindowShutdownMonitor.onConnectionCountChange,
    onManagedWindowClose: managedWindowShutdownMonitor.onManagedWindowClose,
    builtinToolOptions,
    operatorTransport: {
      sessionManager,
      systemPrompt: bootstrapContext.systemPrompt,
      onClear: sessionManager.onClear,
      onResumeSession: (sessionId) => {
        sessionManager.setResumeSession(sessionId);
      },
      contextArtifactCache,
      executionMode: flags.plan ? "plan" : "execute",
      workingDirectory: cwd,
      domainLabel: bootstrapContext.domainLabel,
    },
  });

  let viteDevChild: ChildProcess | undefined;
  if (mode === "dev") {
    viteDevChild = spawnGuiDevServer(cwd, guiPort, gateway.port);
  }

  const gatewayUrl = `http://localhost:${gateway.port}/gui/`;
  const devGuiUrl = `http://localhost:${guiPort}/gui/`;
  const guiUrl = buildGuiUrl(mode === "dev" ? devGuiUrl : gatewayUrl, themePreference);
  printStartupBanner({ mode, gatewayUrl, guiUrl, apiUrl: gateway.apiUrl });

  let guiWindow: GuiWindowSession | undefined;
  try {
    if (flags.open ?? true) {
      guiWindow = launchGuiWindow(guiUrl);
      console.log(`GUI window host: ${guiWindow.browserLabel}`);
    }
  } catch (error) {
    if (viteDevChild) {
      await stopChildProcess(viteDevChild, "gui-dev");
    }
    gateway.shutdown();
    throw error;
  }

  await waitForShutdown(async () => {
    managedWindowShutdownMonitor.dispose();
    guiWindow?.close();
    if (viteDevChild) {
      await stopChildProcess(viteDevChild, "gui-dev");
    }
    gateway.shutdown();
  }, guiWindow, guiWindow ? managedWindowShutdownMonitor.waitForDisconnect() : undefined);
}

async function guiAttachCommand(
  connectUrl: string,
  themePreference: ReturnType<typeof resolveGuiThemePreference>,
  flags: GuiFlags,
): Promise<void> {
  const guiUrl = buildGuiAttachUrl(connectUrl, themePreference);
  const gatewayUrl = new URL(guiUrl).origin;
  printStartupBanner({
    mode: "attach",
    gatewayUrl: `${gatewayUrl}/gui/`,
    guiUrl,
    apiUrl: `${gatewayUrl}/gui/api/dashboard`,
  });

  let guiWindow: GuiWindowSession | undefined;
  if (flags.open ?? true) {
    guiWindow = launchGuiWindow(guiUrl);
    console.log(`GUI window host: ${guiWindow.browserLabel}`);
    await waitForShutdown(() => {
      guiWindow?.close();
    }, guiWindow);
  }
}

function parseProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId | null {
  const provider = typeof p === "string" ? p.trim() : "";
  if (provider.length === 0) {
    return null;
  }
  if (providerIds.includes(provider as ProviderId)) {
    return provider as ProviderId;
  }
  throw new Error(
    `Unknown GUI provider '${provider}'. Configure one of: ${providerIds.join(", ")}`,
  );
}

async function resolveGuiBootstrapContext(
  appConfig: KilnAppConfig,
  cwd: string,
  contextArtifactCache: Awaited<ReturnType<typeof getProjectContextArtifactCache>>,
): Promise<{ systemPrompt: string; domainLabel: string }> {
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = {
      mode: "cli-wrapper" as const,
      permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const },
    };
    const manager = new SessionManager(wrapperConfig, appConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    return {
      systemPrompt: context.systemPrompt,
      domainLabel: context.domain.displayName,
    };
  } catch {
    return {
      systemPrompt: "You are a helpful assistant.",
      domainLabel: "kiln",
    };
  }
}

async function buildDashboardSnapshot(
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  providers: readonly ReturnType<typeof getProviderDisplayInfo>[number][],
  runtimeProviderModels: Record<string, string[]>,
  runtimeProviderDiscovery: readonly GuiProviderDiscoveryResult[],
  workingDirectory: string,
  domainLabel: string,
  workspaceExplorer: OperatorWorkspaceExplorer,
): Promise<GuiDashboardSnapshot> {
  const sessions = await loadSessionSummaries(sessionStore, transcriptStore);

  const providerHealth = new Map(
    Object.entries(getRuntimeProviderAvailability(registry)),
  );

  const discoveryByProvider = new Map(runtimeProviderDiscovery.map((entry) => [entry.provider, entry] as const));
  const providerDescriptors: GuiProviderDescriptor[] = providers.map((provider) => {
    const discovery = discoveryByProvider.get(provider.id);
    if (discovery) {
      return {
        id: provider.id,
        label: toProviderLabel(provider.id),
        group: provider.group,
        models: [...discovery.models],
        free: provider.free,
        available: discovery.available,
        status: discovery.status,
        reason: discovery.reason,
        authState: discovery.authState,
        lastCheckedAt: discovery.lastCheckedAt,
      };
    }
    const hasRuntimeModelEntry = Object.prototype.hasOwnProperty.call(runtimeProviderModels, provider.id);
    const models = runtimeProviderModels[provider.id] ?? [];
    const available = (providerHealth.get(provider.id) ?? false)
      && (models.length > 0 || (hasRuntimeModelEntry && isGuiProviderModeless(provider.id)));
    return {
      id: provider.id,
      label: toProviderLabel(provider.id),
      group: provider.group,
      models: available ? models : [],
      free: provider.free,
      available,
    };
  });

  const telemetry = await readTelemetrySnapshot();
  const resumeInfo = await loadResumeSidebarInfo(
    sessionStore,
    transcriptStore,
    providers.map((provider) => provider.id),
  );
  const resumeInfoByProvider = Object.fromEntries(
    Object.entries(resumeInfo).flatMap(([provider, info]) => (
      info.strategy
        ? [[provider, { strategy: info.strategy, feedbackLabel: info.feedbackLabel }]]
        : []
    )),
  );
  const workspaceTree = await workspaceExplorer.listDirectory().catch(() => undefined);

  return {
    providers: providerDescriptors,
    sessions,
    telemetry,
    resumeInfoByProvider,
    workingDirectory,
    domainLabel,
    workspaceTree,
  };
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

function printStartupBanner(input: { mode: "dev" | "prod" | "attach"; gatewayUrl: string; guiUrl: string; apiUrl: string }): void {
  console.log("Kiln GUI");
  console.log(`Mode: ${input.mode}`);
  console.log(`Gateway URL: ${input.gatewayUrl}`);
  console.log(`GUI URL: ${input.guiUrl}`);
  console.log(`Dashboard API: ${input.apiUrl}`);
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

async function waitForShutdown(
  onShutdown: () => Promise<void> | void,
  guiWindow?: GuiWindowSession,
  managedWindowDisconnect?: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      guiWindow?.whenClosed.catch((error) => {
        console.error(`GUI window exited unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      });
      Promise.resolve(onShutdown()).finally(resolve);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    void managedWindowDisconnect?.then(shutdown);
    void guiWindow?.whenClosed.then(shutdown, (error) => {
      console.error(`Could not launch GUI window: ${error instanceof Error ? error.message : String(error)}`);
      shutdown();
    });
  });
}
