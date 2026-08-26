import type {
  GuiDashboardSnapshot,
  GuiAppDescriptor,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  KilnConfigSetupAction,
  KilnConfigSetupActionResult,
  KilnConfigSetupSnapshot,
  KilnConfigurationOnboardingApplyRequest,
  KilnConfigurationOnboardingResult,
  KilnConfigurationOnboardingSnapshot,
  KilnSettingsApplyRequest,
  KilnSettingsMutationResult,
  KilnSettingsProposalProjection,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
  GuiProviderDescriptor,
  GuiContinuationInfo,
  GuiSessionDetail,
  OperatorSessionSummary,
  GuiTelemetrySnapshot,
  OperatorWorkspaceDirectorySnapshot,
  OperatorWorkspaceEntryKind,
  OperatorWorkspaceFileSnapshot,
  OperatorWorkspaceVcsState,
  OperatorWorkspaceVcsStatus,
  OperatorResourceReadContent,
  OperatorResourceReadRequest,
  OperatorResourceReadResult,
  OperatorCockpitActionTarget,
} from "@kilnai/gateway-contracts";
import {
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  isOperatorAppearancePreference,
  OPERATOR_THEME_DEFINITIONS_BY_ID,
  type OperatorAppearancePreference,
  type OperatorThemeName,
} from "@kilnai/operator-appearance";
import {
  KilnConfigSetupActionResultSchema,
  KilnConfigSetupSnapshotSchema,
  KilnConfigurationOnboardingApplyRequestSchema,
  KilnConfigurationOnboardingResultSchema,
  KilnConfigurationOnboardingSnapshotSchema,
  KilnSettingsApplyRequestSchema,
  KilnSettingsMutationResultSchema,
  KilnSettingsProposalProjectionSchema,
  KilnSettingsProposalRequestSchema,
  KilnSettingsSnapshotSchema,
  GuiMemoryLatticeGraphRequestSchema,
  GuiMemoryLatticeGraphResponseSchema,
  OperatorResourceReadRequestSchema,
  OperatorResourceReadResultSchema,
  OperatorSessionHistoryResponseSchema,
  ExecutionRouteCatalogSchema,
  projectOperatorResourceReadPresentation,
} from "@kilnai/gateway-contracts";

export type {
  GuiDashboardSnapshot,
  GuiProviderDescriptor,
  GuiAppDescriptor,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  KilnConfigSetupAction,
  KilnConfigSetupActionResult,
  KilnConfigSetupSnapshot,
  KilnConfigurationOnboardingApplyRequest,
  KilnConfigurationOnboardingResult,
  KilnConfigurationOnboardingSnapshot,
  KilnSettingsApplyRequest,
  KilnSettingsMutationResult,
  KilnSettingsProposalProjection,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
  OperatorSessionSummary,
  GuiTelemetrySnapshot,
  OperatorResourceReadRequest,
  OperatorResourceReadResult,
};

export class GuiGatewayClient {
  private resolvedBaseUrl: string | null = null;

  constructor(
    private readonly baseUrl: string = window.location.origin,
    private readonly operatorToken?: string,
  ) {}

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
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Gateway did not become ready within ${timeoutMs}ms`);
  }

  async loadOperatorSessionHistory(): Promise<readonly OperatorSessionSummary[]> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/operator/api/sessions", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = OperatorSessionHistoryResponseSchema.parse(await response.json());
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

  async loadConfigSetup(options: { readonly refreshSkillDiagnostics?: boolean } = {}): Promise<KilnConfigSetupSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/config/setup", candidateBaseUrl);
      if (options.refreshSkillDiagnostics) url.searchParams.set("refreshSkillDiagnostics", "true");
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

  async executeConfigSetupAction(action: KilnConfigSetupAction): Promise<KilnConfigSetupActionResult> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];

    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/config/setup/actions", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action }),
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = KilnConfigSetupActionResultSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Setup action failed (${failures.join(" | ")})`
        : "Setup action failed.",
    );
  }

  async loadConfigurationOnboarding(): Promise<KilnConfigurationOnboardingSnapshot> {
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];
    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/config/onboarding", candidateBaseUrl);
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = KilnConfigurationOnboardingSnapshotSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }
    throw new Error(failures.length > 0
      ? `Onboarding status fetch failed (${failures.join(" | ")})`
      : "Onboarding status fetch failed.");
  }

  async applyConfigurationOnboarding(
    request: KilnConfigurationOnboardingApplyRequest,
  ): Promise<KilnConfigurationOnboardingResult> {
    const admittedRequest = KilnConfigurationOnboardingApplyRequestSchema.parse(request);
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    const failures: string[] = [];
    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/config/onboarding", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(this.operatorToken ? { "x-kiln-operator-token": this.operatorToken } : {}),
          },
          body: JSON.stringify(admittedRequest),
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = KilnConfigurationOnboardingResultSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }
    throw new Error(failures.length > 0
      ? `Onboarding apply failed (${failures.join(" | ")})`
      : "Onboarding apply failed.");
  }

  async loadSettings(): Promise<KilnSettingsSnapshot> {
    return this.requestSettings(
      "/gui/api/config/settings",
      undefined,
      KilnSettingsSnapshotSchema,
      "Settings fetch failed",
    );
  }

  async proposeSettingsMutation(
    request: KilnSettingsProposalRequest,
  ): Promise<KilnSettingsProposalProjection> {
    const admittedRequest = KilnSettingsProposalRequestSchema.parse(request);
    return this.requestSettings(
      "/gui/api/config/settings/proposals",
      admittedRequest,
      KilnSettingsProposalProjectionSchema,
      "Settings proposal failed",
    );
  }

  async applySettingsMutation(
    request: KilnSettingsApplyRequest,
  ): Promise<KilnSettingsMutationResult> {
    const admittedRequest = KilnSettingsApplyRequestSchema.parse(request);
    return this.requestSettings(
      "/gui/api/config/settings/apply",
      admittedRequest,
      KilnSettingsMutationResultSchema,
      "Settings apply failed",
    );
  }

  private async requestSettings<T>(
    path: string,
    body: unknown | undefined,
    schema: { parse(value: unknown): T },
    failureLabel: string,
  ): Promise<T> {
    const failures: string[] = [];
    for (const candidateBaseUrl of this.resolveCandidateBaseUrls()) {
      const url = new URL(path, candidateBaseUrl);
      try {
        const response = await fetch(url, body === undefined ? {
          headers: { accept: "application/json" },
        } : {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(this.operatorToken ? { "x-kiln-operator-token": this.operatorToken } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          failures.push(`${candidateBaseUrl}: status ${response.status}`);
          continue;
        }
        const payload = schema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch (error) {
        failures.push(`${candidateBaseUrl}: ${errorMessage(error)}`);
      }
    }
    throw new Error(failures.length > 0
      ? `${failureLabel} (${failures.join(" | ")})`
      : `${failureLabel}.`);
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
      }
    }

    return null;
  }

  resolveCandidateBaseUrls(): string[] {
    return resolveCandidateBaseUrls(this.baseUrl, this.resolvedBaseUrl);
  }

  async saveAppearancePreference(
    preference: OperatorAppearancePreference,
    expectedRevision: string,
  ): Promise<void> {
    const proposal = await this.proposeSettingsMutation({
      operation: "setting.set",
      scope: "global",
      key: "ui.appearance",
      expectedRevision,
      value: preference,
    });
    if (proposal.status !== "valid") {
      throw new Error(proposal.diagnostics.map((diagnostic) => diagnostic.message).join(" ") || "Theme proposal is invalid.");
    }
    const result = await this.applySettingsMutation({ proposalId: proposal.proposalId });
    if (result.outcome !== "committed") {
      throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
        || (result.outcome === "rejected" ? "Theme change was rejected." : "Theme change committed but reconciliation failed."));
    }
  }

  async saveThemePreference(
    theme: OperatorThemeName,
    scheme?: "light" | "dark",
  ): Promise<OperatorAppearancePreference> {
    const snapshot = await this.loadSettings();
    const value = snapshot.entries.find((entry) => entry.key === "ui.appearance")?.effective.value;
    const current = isOperatorAppearancePreference(value)
      ? value
      : DEFAULT_OPERATOR_APPEARANCE_PREFERENCE;
    const definition = OPERATOR_THEME_DEFINITIONS_BY_ID[theme];
    const selectedScheme = scheme
      ?? (definition.variants.light && !definition.variants.dark
        ? "light"
        : definition.variants.dark && !definition.variants.light
          ? "dark"
          : current.mode === "light" || current.mode === "dark"
            ? current.mode
            : "dark");
    if (!definition.variants[selectedScheme]) {
      throw new Error(`Theme '${theme}' does not provide a ${selectedScheme} variant.`);
    }
    const preference: OperatorAppearancePreference = {
      mode: selectedScheme,
      themeByScheme: { ...current.themeByScheme, [selectedScheme]: theme },
    };
    await this.saveAppearancePreference(preference, snapshot.revisions.global ?? "absent");
    return preference;
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

  async readResource(request: OperatorResourceReadRequest): Promise<OperatorResourceReadResult | null> {
    const uri = request.uri.trim();
    if (!uri) {
      return null;
    }
    const normalizedRequest = OperatorResourceReadRequestSchema.parse({
      ...request,
      uri,
    });
    const candidateBaseUrls = this.resolveCandidateBaseUrls();
    for (const candidateBaseUrl of candidateBaseUrls) {
      const url = new URL("/gui/api/resources/read", candidateBaseUrl);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(normalizedRequest),
        });
        if (!response.ok) {
          continue;
        }
        const payload = OperatorResourceReadResultSchema.parse(await response.json());
        this.resolvedBaseUrl = candidateBaseUrl;
        return payload;
      } catch {
      }
    }
    return null;
  }

  async loadResourceDataUrl(uri: string, target?: OperatorCockpitActionTarget): Promise<string | null> {
    const sessionId = target?.sessionId?.trim();
    if (!sessionId) {
      return null;
    }
    const result = await this.readResource({
      uri,
      target: { ...target, sessionId },
    });
    if (result?.summary) {
      return summarizedResourceDataUrl(result);
    }
    const content = result?.contents[0];
    return content ? resourceContentDataUrl(content) : null;
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

  const executionRouteCatalog = ExecutionRouteCatalogSchema.parse(snapshot.executionRouteCatalog);
  if (!isTelemetrySnapshot(snapshot.telemetry)) {
    throw new Error("Invalid dashboard telemetry payload.");
  }
  if (!isRecord(snapshot.continuationInfoByProvider)) {
    throw new Error("Invalid dashboard continuation payload.");
  }

  const apps = normalizeAppDescriptors(snapshot.apps);
  const workspaceTree = normalizeWorkspaceTreeSnapshot(snapshot.workspaceTree);
  return {
    executionRouteCatalog,
    providers: snapshot.providers,
    telemetry: snapshot.telemetry,
    continuationInfoByProvider: snapshot.continuationInfoByProvider as Record<string, GuiContinuationInfo>,
    ...(isRecord(snapshot.operatorWorkspaceHome) ? { operatorWorkspaceHome: snapshot.operatorWorkspaceHome } : {}),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function resourceContentDataUrl(content: OperatorResourceReadContent): string {
  if (content.kind === "blob") {
    return `data:${content.mimeType ?? "application/octet-stream"};base64,${content.blob}`;
  }
  return `data:${content.mimeType ?? "text/plain"};charset=utf-8;base64,${base64EncodeUtf8(content.text)}`;
}

function summarizedResourceDataUrl(result: OperatorResourceReadResult): string {
  return `data:application/json;charset=utf-8;base64,${base64EncodeUtf8(JSON.stringify({
    ...result,
    presentation: projectOperatorResourceReadPresentation(result),
  }, null, 2))}`;
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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

export type { GuiContinuationInfo, GuiSessionDetail };
