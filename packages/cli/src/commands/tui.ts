import type { KilnAppConfig } from "../config.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { SessionStore } from "../wrapper/session-store.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { CliSessionFactory, CliSession } from "@kilnai/runtime";

export interface TuiFlags {
  provider?: string;
  cwd?: string;
  port?: number;
  theme?: string;
}

const VALID_PROVIDERS = ["claude", "codex", "opencode"] as const;
type SupportedProvider = (typeof VALID_PROVIDERS)[number];

function parseProvider(p?: string): SupportedProvider {
  if (p && VALID_PROVIDERS.includes(p as SupportedProvider)) {
    return p as SupportedProvider;
  }
  return "claude";
}

/**
 * Stateful session factory that tracks the last provider session ID
 * for cross-turn resume. Each call creates a fresh CLI subprocess,
 * but passes the previous turn's session ID for conversation continuity.
 * Persists session records so resumeSessionId survives process restarts.
 */
export async function makeResumableSessionFactory(
  provider: SupportedProvider,
  cwd: string,
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
): Promise<{ factory: CliSessionFactory; onClear: () => Promise<void> }> {
  const lastRecord = await sessionStore.last(provider);
  let resumeSessionId: string | undefined = lastRecord?.sessionId;

  const factory = (systemPrompt: string, sessionCwd: string) => {
    const session = registry.createSession(provider, {
      task: "interactive",
      systemPrompt,
      cwd: sessionCwd || cwd,
      permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      resumeSessionId,
    });

    // Capture session ID for next turn's resume and persist to disk
    const originalDispose = session.dispose.bind(session);
    session.dispose = async () => {
      const capturedId = session.sessionId;
      await originalDispose();
      resumeSessionId = capturedId;
      await sessionStore.append({
        sessionId: capturedId,
        provider,
        task: "interactive",
        completedAt: new Date().toISOString(),
        cost: 0,
        projectPath: cwd,
        providerSessionId: session.providerSessionId,
      });
    };

    return session as unknown as CliSession;
  };

  const onClear = async () => {
    resumeSessionId = undefined;
    await sessionStore.clearLast(provider);
  };

  return { factory, onClear };
}

export async function tuiCommand(appConfig: KilnAppConfig, flags: TuiFlags = {}): Promise<void> {
  const { startTui } = await import("@kilnai/tui");
  const { startTuiGateway } = await import("@kilnai/runtime");
  const { registry } = createDefaultRegistry();

  const cwd = flags.cwd ?? process.cwd();
  const provider = parseProvider(flags.provider);

  // Resolve domain display name from app config if available
  let domain = "kiln";
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = { mode: "cli-wrapper" as const, permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const } };
    const manager = new SessionManager(wrapperConfig, appConfig);
    const context = await manager.prepare("interactive", cwd);
    domain = context.domain.displayName;
  } catch {
    // Non-fatal — proceed without domain name
  }

  // Inject CLI session factory into the gateway (dependency inversion)
  const sessionStore = new SessionStore(cwd);
  const { factory: sessionFactory, onClear } = await makeResumableSessionFactory(provider, cwd, registry, sessionStore);

  // Start the in-process TUI gateway on port 4801
  const gateway = await startTuiGateway({ provider, sessionFactory, port: flags.port, onClear });

  // Wait for gateway to be ready before connecting the TUI
  await waitForGateway(`http://localhost:${gateway.port}/health`);

  // GatewaySession is the sole SessionLike — gateway owns orchestration
  const createSession = async () => new GatewaySession(gateway.url);

  const shutdown = (code = 0, error?: unknown) => {
    gateway.shutdown();
    if (error) {
      process.stderr.write(String(error instanceof Error ? (error.stack ?? error.message) : error) + "\n");
      process.exitCode = 1;
    } else {
      process.exitCode = code;
    }
    setTimeout(() => process.exit(process.exitCode ?? code), 50).unref();
  };

  const handlers = [
    ["SIGINT", () => shutdown(0)],
    ["SIGTERM", () => shutdown(0)],
    ["SIGHUP", () => shutdown(0)],
    ["uncaughtException", (e: unknown) => shutdown(1, e)],
    ["unhandledRejection", (e: unknown) => shutdown(1, e)],
  ] as const;

  for (const [ev, handler] of handlers) process.on(ev, handler);

  const resolvedTheme = themes[flags.theme ?? "kiln-dark"] ?? kilnDark;
  await startTui(createSession, provider, domain, resolvedTheme);

  gateway.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}