import type {
  GuiDashboardSnapshot,
  GuiProviderDescriptor,
  GuiResumeInfo,
  GuiSessionDetail,
  GuiSessionListResponse,
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

export class GuiGatewayClient {
  private resolvedBaseUrl: string | null = null;

  constructor(private readonly baseUrl: string = window.location.origin) {}

  async loadDashboard(): Promise<GuiDashboardSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/dashboard", candidateBaseUrl);

      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }

        const payload = parseDashboardSnapshot(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
        continue;
      }
    }

    throw new Error(
      failures.length > 0
        ? `Dashboard fetch failed (${failures.join(" | ")})`
        : "Dashboard fetch failed.",
    );
  }

  async waitForHealth({ intervalMs = 200, timeoutMs = 10_000 }: { intervalMs?: number; timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const candidateBaseUrl of this.resolveCandidateBaseUrls()) {
        const url = new URL("/health", candidateBaseUrl);
        try {
          const response = await fetch(url, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(intervalMs),
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
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Gateway did not become ready within ${timeoutMs}ms`);
  }

  async loadSessions(): Promise<readonly GuiSessionSummary[]> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/sessions", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = parseSessionListResponse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload.sessions;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Session list fetch failed (${failures.join(" | ")})`
        : "Session list fetch failed.",
    );
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

type DashboardWorkspaceTreeSnapshot = NonNullable<GuiDashboardSnapshot["workspaceTree"]>;

export function resolveCandidateBaseUrls(baseUrl: string, resolvedBaseUrl?: string | null): string[] {
  const candidates: string[] = [];

  const pushCandidate = (value: string | null) => {
    if (!value || candidates.includes(value)) {
      return;
    }
    candidates.push(value);
  };

  pushCandidate(normalizeBaseUrl(resolvedBaseUrl));
  pushCandidate(normalizeBaseUrl(baseUrl));
  return candidates;
}

function normalizeBaseUrl(baseUrl: string | null | undefined): string | null {
  if (typeof baseUrl !== "string") {
    return null;
  }
  const normalized = baseUrl.trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
}

function normalizeWorkspaceTreeSnapshot(
  value: GuiDashboardSnapshot["workspaceTree"] | null | undefined,
): DashboardWorkspaceTreeSnapshot | undefined {
  if (!value) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid dashboard workspace tree payload.");
  }
  if (typeof value.rootPath !== "string") {
    throw new Error("Invalid dashboard workspace tree rootPath.");
  }
  if (!Array.isArray(value.entries)) {
    throw new Error("Invalid dashboard workspace tree entries payload.");
  }

  const entries = value.entries.map((entry) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.name !== "string") {
      throw new Error("Invalid dashboard workspace tree entry.");
    }
    if (entry.kind !== "directory" && entry.kind !== "file") {
      throw new Error("Invalid dashboard workspace tree entry kind.");
    }
    return {
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
    };
  });

  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    throw new Error("Invalid dashboard workspace tree truncated flag.");
  }
  if (value.source !== undefined && value.source !== "gateway") {
    throw new Error("Invalid dashboard workspace tree source.");
  }
  if (value.worktreePath !== undefined && typeof value.worktreePath !== "string") {
    throw new Error("Invalid dashboard workspace tree worktreePath.");
  }

  return {
    rootPath: value.rootPath,
    entries,
    truncated: value.truncated,
    source: value.source,
    worktreePath: value.worktreePath,
  };
}

function parseDashboardSnapshot(value: unknown): GuiDashboardSnapshot {
  if (!isRecord(value)) {
    throw new Error("Invalid dashboard response body.");
  }
  const snapshot = value as Partial<GuiDashboardSnapshot>;
  if (!Array.isArray(snapshot.providers)) {
    throw new Error("Invalid dashboard providers payload.");
  }
  if (!Array.isArray(snapshot.sessions)) {
    throw new Error("Invalid dashboard sessions payload.");
  }
  if (!isTelemetrySnapshot(snapshot.telemetry)) {
    throw new Error("Invalid dashboard telemetry payload.");
  }
  if (!isRecord(snapshot.resumeInfoByProvider)) {
    throw new Error("Invalid dashboard resume payload.");
  }

  return {
    providers: snapshot.providers,
    sessions: snapshot.sessions,
    telemetry: snapshot.telemetry,
    resumeInfoByProvider: snapshot.resumeInfoByProvider as Record<string, GuiResumeInfo>,
    workingDirectory: typeof snapshot.workingDirectory === "string" ? snapshot.workingDirectory : undefined,
    domainLabel: typeof snapshot.domainLabel === "string" ? snapshot.domainLabel : undefined,
    workspaceTree: normalizeWorkspaceTreeSnapshot(snapshot.workspaceTree),
  };
}

function parseSessionListResponse(value: unknown): GuiSessionListResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid session list response body.");
  }
  const payload = value as Partial<GuiSessionListResponse>;
  if (!Array.isArray(payload.sessions)) {
    throw new Error("Invalid session list payload.");
  }
  return {
    sessions: payload.sessions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isTelemetrySnapshot(value: unknown): value is GuiTelemetrySnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.status === "string"
    && Array.isArray(value.dominantRegions)
    && value.dominantRegions.every((region) => typeof region === "string")
    && typeof value.saturation === "number"
    && typeof value.entropy === "number"
  );
}

export {
  GuiSessionClient,
  type GuiInboundFrame,
  type GuiSessionConnectionState,
} from "./session-client.js";

export type { GuiResumeInfo, GuiSessionDetail };
