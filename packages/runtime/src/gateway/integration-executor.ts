// Infrastructure: executes integration operations with credential resolution
// Created per-tenant per-integration inside buildTenantToolContext()

import type { CredentialResolver, IntegrationAdapter, ExecutionOptions } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

const DEFAULT_TIMEOUT_MS = 30_000;

export class IntegrationExecutor {
  constructor(
    private readonly adapter: IntegrationAdapter,
    private readonly credentialResolver: CredentialResolver,
    private readonly tenantId: string,
    private readonly credentialKey: string,
  ) {}

  async execute(operationName: string, input: Record<string, unknown>): Promise<unknown> {
    const operation = this.adapter.operations.find((op) => op.name === operationName);
    if (!operation) {
      throw new KilnError("INTEGRATION_TOOL_FAILED", `Operation "${operationName}" not found on adapter "${this.adapter.provider}"`, {
        context: { provider: this.adapter.provider, operation: operationName },
        retryable: false,
      });
    }

    let credential;
    try {
      credential = await this.credentialResolver.resolve(this.tenantId, this.credentialKey);
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError("CREDENTIAL_RESOLVE_FAILED", `Failed to resolve credentials for "${this.credentialKey}"`, {
        context: { tenantId: this.tenantId, credentialKey: this.credentialKey },
        retryable: true,
        cause: err,
      });
    }

    const options: ExecutionOptions = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };

    try {
      const result = await this.adapter.execute(operationName, credential, input, options);
      return result.data;
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError(
        "INTEGRATION_TOOL_FAILED",
        `Integration "${this.adapter.provider}.${operationName}" failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          context: { provider: this.adapter.provider, operation: operationName, tenantId: this.tenantId },
          retryable: true,
          cause: err,
        },
      );
    }
  }
}
