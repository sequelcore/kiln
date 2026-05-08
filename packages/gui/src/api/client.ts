import type {
  GuiDashboardSnapshot,
  GuiAppDescriptor,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  KilnConfigSetupSnapshot,
  GuiProviderDescriptor,
  GuiResumeInfo,
  GuiSessionDetail,
  GuiSessionListResponse,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
  OperatorWorkspaceDirectorySnapshot,
  OperatorWorkspaceEntryKind,
  OperatorWorkspaceFileSnapshot,
  OperatorWorkspaceVcsState,
  OperatorWorkspaceVcsStatus,
  OperatorThemeName,
} from "@kilnai/gateway-contracts";
import {
  KilnConfigSetupSnapshotSchema,
  GuiMemoryLatticeGraphRequestSchema,
  GuiMemoryLatticeGraphResponseSchema,
} from "@kilnai/gateway-contracts";
import { GuiSessionClient, type GuiSessionClientOptions } from "./session-client.js";

export type {
  GuiDashboardSnapshot,
  GuiProviderDescriptor,
  GuiAppDescriptor,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  KilnConfigSetupSnapshot,
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

  async loadMemoryLatticeGraph(
    request: GuiMemoryLatticeGraphRequest = {},
  ): Promise<GuiMemoryLatticeGraphResponse> {
    const normalizedRequest = GuiMemoryLatticeGraphRequestSchema.parse(request);
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/memory/graph", candidateBaseUrl);
      appendMemoryLatticeGraphQuery(url.searchParams, normalizedRequest);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = GuiMemoryLatticeGraphResponseSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Memory Lattice graph fetch failed (${failures.join(" | ")})`
        : "Memory Lattice graph fetch failed.",
    );
  }

  async loadConfigSetup(): Promise<KilnConfigSetupSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/config/setup", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = KilnConfigSetupSnapshotSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Setup status fetch failed (${failures.join(" | ")})`
        : "Setup status fetch failed.",
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

  async saveThemePreference(theme: OperatorThemeName): Promise<void> {
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

  async loadWorkspaceDirectory(path?: string): Promise<OperatorWorkspaceDirectorySnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/workspace/tree", candidateBaseUrl);
      if (path) {
        url.searchParams.set("path", path);
      }
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = parseWorkspaceDirectorySnapshot(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Workspace directory fetch failed (${failures.join(" | ")})`
        : "Workspace directory fetch failed.",
    );
  }

  async loadWorkspaceFile(path: string): Promise<OperatorWorkspaceFileSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/workspace/file", candidateBaseUrl);
      url.searchParams.set("path", path);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = parseWorkspaceFileSnapshot(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Workspace file fetch failed (${failures.join(" | ")})`
        : "Workspace file fetch failed.",
    );
  }

  async loadResourceDataUrl(uri: string): Promise<string | null> {
    const normalizedUri = uri.trim();
    if (!normalizedUri) {
      return null;
    }
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/resources/content", candidateBaseUrl);
      url.searchParams.set("uri", normalizedUri);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          continue;
        }
        const payload = await response.json() as { dataUrl?: unknown };
        if (typeof payload.dataUrl === "string" && payload.dataUrl.startsWith("data:")) {
          this.resolvedBaseUrl = candidateBaseUrl;
          return payload.dataUrl;
        }
      } catch {
        continue;
      }
    }
    return null;
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

function appendMemoryLatticeGraphQuery(
  query: URLSearchParams,
  request: GuiMemoryLatticeGraphRequest,
): void {
  if (request.scope) {
    query.set("scopeKind", request.scope.kind);
    query.set("scopeId", request.scope.id);
  }
  if (request.layer) {
    query.set("layer", request.layer);
  }
  const search = request.query?.trim();
  if (search) {
    query.set("query", search);
  }
  if (request.depth !== undefined) {
    query.set("depth", String(request.depth));
  }
  if (request.limit !== undefined) {
    query.set("limit", String(request.limit));
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

  const apps = normalizeAppDescriptors(snapshot.apps);
  const workspaceTree = normalizeWorkspaceTreeSnapshot(snapshot.workspaceTree);
  return {
    providers: snapshot.providers,
    sessions: snapshot.sessions,
    telemetry: snapshot.telemetry,
    resumeInfoByProvider: snapshot.resumeInfoByProvider as Record<string, GuiResumeInfo>,
    ...(apps ? { apps } : {}),
    ...(typeof snapshot.activeAppName === "string" ? { activeAppName: snapshot.activeAppName } : {}),
    ...(typeof snapshot.activeTenantId === "string" ? { activeTenantId: snapshot.activeTenantId } : {}),
    ...(typeof snapshot.workingDirectory === "string" ? { workingDirectory: snapshot.workingDirectory } : {}),
    ...(typeof snapshot.domainLabel === "string" ? { domainLabel: snapshot.domainLabel } : {}),
    ...(workspaceTree ? { workspaceTree } : {}),
  };
}

function normalizeAppDescriptors(value: GuiDashboardSnapshot["apps"] | null | undefined): readonly GuiAppDescriptor[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid dashboard apps payload.");
  }
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error("Invalid dashboard app descriptor.");
    }
    if (entry.runtime !== "provider-adapter" && entry.runtime !== "tenant" && entry.runtime !== "none") {
      throw new Error("Invalid dashboard app runtime.");
    }
    if (!Array.isArray(entry.channels) || !entry.channels.every((channel) => typeof channel === "string")) {
      throw new Error("Invalid dashboard app channels.");
    }
    if (typeof entry.runtimeCapable !== "boolean") {
      throw new Error("Invalid dashboard app runtimeCapable flag.");
    }
    const tenants = entry.tenants;
    if (tenants !== undefined) {
      if (!Array.isArray(tenants)) {
        throw new Error("Invalid dashboard app tenants.");
      }
    }
    const normalizedTenants = tenants?.map((tenant) => {
      if (!isRecord(tenant) || typeof tenant.tenantId !== "string" || typeof tenant.enabled !== "boolean") {
        throw new Error("Invalid dashboard app tenant descriptor.");
      }
      if (tenant.label !== undefined && typeof tenant.label !== "string") {
        throw new Error("Invalid dashboard app tenant label.");
      }
      return {
        tenantId: tenant.tenantId,
        enabled: tenant.enabled,
        ...(typeof tenant.label === "string" ? { label: tenant.label } : {}),
      };
    });
    return {
      name: entry.name,
      runtime: entry.runtime,
      channels: entry.channels,
      runtimeCapable: entry.runtimeCapable,
      ...(normalizedTenants ? { tenants: normalizedTenants } : {}),
    };
  });
}

function parseWorkspaceDirectorySnapshot(value: unknown): OperatorWorkspaceDirectorySnapshot {
  if (!isRecord(value)) {
    throw new Error("Invalid workspace directory response body.");
  }
  if (typeof value.rootPath !== "string") {
    throw new Error("Invalid workspace directory rootPath.");
  }
  if (typeof value.directoryPath !== "string") {
    throw new Error("Invalid workspace directory path.");
  }
  if (!Array.isArray(value.entries)) {
    throw new Error("Invalid workspace directory entries payload.");
  }
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.name !== "string") {
      throw new Error("Invalid workspace directory entry.");
    }
    if (entry.kind !== "directory" && entry.kind !== "file") {
      throw new Error("Invalid workspace directory entry kind.");
    }
    const kind: OperatorWorkspaceEntryKind = entry.kind;
    return {
      path: entry.path,
      name: entry.name,
      kind,
      ...(typeof entry.sizeBytes === "number" ? { sizeBytes: entry.sizeBytes } : {}),
      ...(typeof entry.modifiedAt === "string" ? { modifiedAt: entry.modifiedAt } : {}),
      ...(isWorkspaceVcsStatus(entry.vcs) ? { vcs: entry.vcs } : {}),
    };
  });
  return {
    rootPath: value.rootPath,
    directoryPath: value.directoryPath,
    ...(typeof value.parentPath === "string" ? { parentPath: value.parentPath } : {}),
    entries,
    ...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
    source: "gateway",
  };
}

const WORKSPACE_VCS_STATES: ReadonlySet<OperatorWorkspaceVcsState> = new Set([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
  "ignored",
  "conflicted",
]);

function isWorkspaceVcsState(value: unknown): value is OperatorWorkspaceVcsState {
  return typeof value === "string" && WORKSPACE_VCS_STATES.has(value as OperatorWorkspaceVcsState);
}

function isWorkspaceVcsStatus(value: unknown): value is OperatorWorkspaceVcsStatus {
  return isRecord(value)
    && value.provider === "git"
    && isWorkspaceVcsState(value.state)
    && (value.staged === undefined || typeof value.staged === "boolean");
}

function parseWorkspaceFileSnapshot(value: unknown): OperatorWorkspaceFileSnapshot {
  if (!isRecord(value)) {
    throw new Error("Invalid workspace file response body.");
  }
  if (typeof value.path !== "string" || typeof value.name !== "string") {
    throw new Error("Invalid workspace file identity.");
  }
  if (value.kind !== "text" && value.kind !== "image" && value.kind !== "binary" && value.kind !== "unsupported") {
    throw new Error("Invalid workspace file preview kind.");
  }
  if (typeof value.sizeBytes !== "number") {
    throw new Error("Invalid workspace file size.");
  }
  return {
    path: value.path,
    name: value.name,
    kind: value.kind,
    sizeBytes: value.sizeBytes,
    ...(typeof value.modifiedAt === "string" ? { modifiedAt: value.modifiedAt } : {}),
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    ...(value.encoding === "utf-8" || value.encoding === "base64" ? { encoding: value.encoding } : {}),
    ...(typeof value.content === "string" ? { content: value.content } : {}),
    ...(typeof value.dataUrl === "string" ? { dataUrl: value.dataUrl } : {}),
    ...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
    ...(typeof value.unsupportedReason === "string" ? { unsupportedReason: value.unsupportedReason } : {}),
    source: "gateway",
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
