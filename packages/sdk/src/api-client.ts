import {
  KilnSettingsApplyRequestSchema,
  KilnSettingsMutationResultSchema,
  KilnSettingsProposalProjectionSchema,
  KilnSettingsProposalRequestSchema,
  KilnSettingsSnapshotSchema,
  OperatorResourceReadRequestSchema,
  OperatorResourceReadResultSchema,
  type KilnSettingsApplyRequest,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalProjection,
  type KilnSettingsProposalRequest,
  type KilnSettingsSnapshot,
  type OperatorResourceReadRequest,
  type OperatorResourceReadResult,
} from "@kilnai/gateway-contracts";

export interface ApiClientOptions {
  readonly operatorToken?: string;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options: ApiClientOptions = {},
  ) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async readResource(request: OperatorResourceReadRequest): Promise<OperatorResourceReadResult> {
    const uri = request.uri.trim();
    const normalizedRequest = OperatorResourceReadRequestSchema.parse({
      ...request,
      uri,
    });
    const res = await fetch(`${this.baseUrl}/gui/api/resources/read`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(normalizedRequest),
    });
    if (!res.ok) {
      throw new Error(`POST /gui/api/resources/read failed: ${res.status} ${res.statusText}`);
    }
    return OperatorResourceReadResultSchema.parse(await res.json());
  }

  async loadSettings(): Promise<KilnSettingsSnapshot> {
    return KilnSettingsSnapshotSchema.parse(await this.settingsRequest("/gui/api/config/settings"));
  }

  async proposeSettingsMutation(
    request: KilnSettingsProposalRequest,
  ): Promise<KilnSettingsProposalProjection> {
    const admitted = KilnSettingsProposalRequestSchema.parse(request);
    return KilnSettingsProposalProjectionSchema.parse(await this.settingsRequest(
      "/gui/api/config/settings/proposals",
      admitted,
    ));
  }

  async applySettingsMutation(
    request: KilnSettingsApplyRequest,
  ): Promise<KilnSettingsMutationResult> {
    const admitted = KilnSettingsApplyRequestSchema.parse(request);
    return KilnSettingsMutationResultSchema.parse(await this.settingsRequest(
      "/gui/api/config/settings/apply",
      admitted,
    ));
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
    }
  }

  private async settingsRequest(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, body === undefined ? {
      headers: { accept: "application/json" },
    } : {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.options.operatorToken ? { "x-kiln-operator-token": this.options.operatorToken } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${body === undefined ? "GET" : "POST"} ${path} failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}
