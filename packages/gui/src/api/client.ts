import type {
  GuiDashboardSnapshot,
  GuiProviderDescriptor,
  GuiResumeInfo,
  GuiSessionDetail,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
} from "@kilnai/gateway-contracts";
import { GuiSessionClient, type GuiSessionClientOptions } from "./session-client.js";

export type {
  GuiDashboardSnapshot,
  GuiProviderDescriptor,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
};

const fallbackSnapshot: GuiDashboardSnapshot = {
  providers: [
    { id: "claude", label: "Claude", group: "harness", free: false, models: [], available: true },
    { id: "codex", label: "Codex", group: "harness", free: false, models: [], available: true },
    { id: "opencode", label: "OpenCode", group: "harness", free: false, models: [], available: true },
    { id: "openai", label: "OpenAI", group: "direct-api", free: false, models: [], available: false },
  ],
  sessions: [],
  telemetry: {
    status: "idle",
    dominantRegions: [],
    saturation: 0,
    entropy: 0,
  },
  resumeInfoByProvider: {},
  workingDirectory: undefined,
  domainLabel: undefined,
  workspaceTree: undefined,
};

export class GuiGatewayClient {
  private resolvedBaseUrl: string | null = null;

  constructor(private readonly baseUrl: string = window.location.origin) {}

  async loadDashboard(): Promise<GuiDashboardSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/dashboard", candidateBaseUrl);

      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          continue;
        }

        const payload = (await response.json()) as Partial<GuiDashboardSnapshot>;
        this.resolvedBaseUrl = candidateBaseUrl;
        return {
          providers: payload.providers ?? fallbackSnapshot.providers,
          sessions: payload.sessions ?? fallbackSnapshot.sessions,
          telemetry: payload.telemetry ?? fallbackSnapshot.telemetry,
          resumeInfoByProvider: payload.resumeInfoByProvider ?? fallbackSnapshot.resumeInfoByProvider,
          workingDirectory: payload.workingDirectory ?? fallbackSnapshot.workingDirectory,
          domainLabel: payload.domainLabel ?? fallbackSnapshot.domainLabel,
          workspaceTree: normalizeWorkspaceTreeSnapshot(payload.workspaceTree) ?? fallbackSnapshot.workspaceTree,
        };
      } catch {
        continue;
      }
    }

    return fallbackSnapshot;
  }

  async loadSessionDetail(sessionId: string): Promise<GuiSessionDetail | null> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }

    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL(`/gui/api/sessions/${encodeURIComponent(normalizedSessionId)}`, candidateBaseUrl);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json()) as GuiSessionDetail;
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch {
        continue;
      }
    }

    return null;
  }

  createSessionClient(options: Omit<GuiSessionClientOptions, "resolveCandidateBaseUrls">): GuiSessionClient {
    return new GuiSessionClient({
      ...options,
      resolveCandidateBaseUrls: () => this.resolveCandidateBaseUrls(),
    });
  }

  resolveCandidateBaseUrls(): string[] {
    return resolveCandidateBaseUrls(this.baseUrl, this.resolvedBaseUrl);
  }

  async saveThemePreference(theme: "kiln-dark" | "kiln-light" | "system-follow"): Promise<void> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/preferences/theme", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ theme }),
        });
        if (!response.ok) {
          continue;
        }
        this.resolvedBaseUrl = candidateBaseUrl;
        return;
      } catch {
        continue;
      }
    }
  }

  notifyWindowClosed(): void {
    for (const candidateBaseUrl of this.resolveCandidateBaseUrls()) {
      const url = new URL("/gui/api/window-closed", candidateBaseUrl);
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) {
        continue;
      }
      void fetch(url, {
        method: "POST",
        keepalive: true,
      }).catch(() => undefined);
    }
  }
}

const GUI_GATEWAY_FALLBACK_PORTS = [4810, 4800] as const;
const GUI_API_BASE_QUERY_PARAM = "apiBase";
const GUI_API_BASE_STORAGE_KEY = "kiln.gui.apiBase";
const VITE_DEV_SERVER_PORT = "5183";
type DashboardWorkspaceTreeSnapshot = NonNullable<GuiDashboardSnapshot["workspaceTree"]>;

export function resolveCandidateBaseUrls(baseUrl: string, resolvedBaseUrl?: string | null): string[] {
  const configuredBase = resolveConfiguredBaseUrl();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const candidates = [
    configuredBase,
    normalizeBaseUrl(resolvedBaseUrl ?? undefined),
    ...GUI_GATEWAY_FALLBACK_PORTS.map((port) => `http://localhost:${port}`),
    shouldIncludeOriginBase(normalizedBaseUrl, configuredBase) ? normalizedBaseUrl : undefined,
  ];
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

function resolveConfiguredBaseUrl(): string | undefined {
  const queryBase = new URLSearchParams(window.location.search).get(GUI_API_BASE_QUERY_PARAM);
  const configuredBase = queryBase ?? readStoredApiBase();
  return normalizeBaseUrl(configuredBase ?? undefined) ?? undefined;
}

function readStoredApiBase(): string | null {
  try {
    return window.localStorage.getItem(GUI_API_BASE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(baseUrl, window.location.origin).origin;
  } catch {
    return null;
  }
}

function shouldIncludeOriginBase(baseUrl: string | null, configuredBase: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }
  if (configuredBase === baseUrl) {
    return true;
  }

  const url = new URL(baseUrl);
  const isLoopbackHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  return !(isLoopbackHost && url.port === VITE_DEV_SERVER_PORT);
}

function normalizeWorkspaceTreeSnapshot(
  value: GuiDashboardSnapshot["workspaceTree"] | null | undefined,
): DashboardWorkspaceTreeSnapshot | undefined {
  if (!value || typeof value.rootPath !== "string" || !Array.isArray(value.entries)) {
    return undefined;
  }

  const entries = value.entries.flatMap((entry) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.name !== "string") {
      return [];
    }
    if (entry.kind !== "directory" && entry.kind !== "file") {
      return [];
    }
    return [{
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
    }];
  });

  return {
    rootPath: value.rootPath,
    entries,
    truncated: value.truncated === true ? true : undefined,
    source: value.source === "gateway" ? "gateway" : undefined,
    worktreePath: typeof value.worktreePath === "string" ? value.worktreePath : undefined,
  };
}

export {
  GuiSessionClient,
  type GuiInboundFrame,
  type GuiSessionConnectionState,
} from "./session-client.js";

export type { GuiResumeInfo, GuiSessionDetail };
