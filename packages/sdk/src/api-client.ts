import {
  OperatorResourceReadRequestSchema,
  OperatorResourceReadResultSchema,
  type OperatorResourceReadRequest,
  type OperatorResourceReadResult,
} from "@kilnai/gateway-contracts";

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

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

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
    }
  }
}
