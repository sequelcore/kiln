import { GuiSessionClient, type GuiSessionClientOptions } from "./session-client.js";

export interface GuiProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct";
  readonly available: boolean;
}

export interface GuiSessionSummary {
  readonly id: string;
  readonly provider: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly costUsd: number;
}

export interface GuiTelemetrySnapshot {
  readonly status: string;
  readonly dominantRegions: readonly string[];
  readonly saturation: number;
  readonly entropy: number;
}

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
}

const fallbackSnapshot: GuiDashboardSnapshot = {
  providers: [
    { id: "claude", label: "Claude", group: "subscription", available: true },
    { id: "codex", label: "Codex", group: "harness", available: true },
    { id: "opencode", label: "OpenCode", group: "harness", available: true },
    { id: "openai", label: "OpenAI", group: "direct", available: false },
  ],
  sessions: [],
  telemetry: {
    status: "idle",
    dominantRegions: [],
    saturation: 0,
    entropy: 0,
  },
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
        };
      } catch {
        continue;
      }
    }

    return fallbackSnapshot;
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
}

const GUI_GATEWAY_FALLBACK_PORTS = [4810, 4800] as const;
const GUI_API_BASE_QUERY_PARAM = "apiBase";
const GUI_API_BASE_STORAGE_KEY = "kiln.gui.apiBase";
const VITE_DEV_SERVER_PORT = "5183";

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

export {
  GuiSessionClient,
  type GuiInboundFrame,
  type GuiSessionConnectionState,
} from "./session-client.js";
