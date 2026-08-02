import { createProviderUsageSnapshot, type ProviderUsageSnapshot } from "@kilnai/core";
import { parseCodexProviderUsage } from "./codex-provider-usage.js";
import type { ProviderUsageStore } from "./file-provider-usage-store.js";

export interface ResolvedCodexUsageCredential {
  readonly credentialId: string;
  readonly accessToken: string;
  readonly chatgptAccountId: string;
}

export interface ReadCodexProviderUsageInput {
  readonly provider: string;
  readonly credentialId: string;
  readonly resolveCredential: () => Promise<ResolvedCodexUsageCredential>;
}

export interface CodexProviderUsageReaderConfig {
  readonly fetch?: typeof globalThis.fetch;
  readonly store: ProviderUsageStore;
  readonly now?: () => Date;
  readonly validForMs?: number;
}

export class CodexProviderUsageReader {
  private readonly now: () => Date;
  private readonly validForMs: number;

  constructor(private readonly config: CodexProviderUsageReaderConfig) {
    this.now = config.now ?? (() => new Date());
    this.validForMs = config.validForMs ?? 5 * 60_000;
  }

  async read(input: ReadCodexProviderUsageInput): Promise<ProviderUsageSnapshot> {
    const observedAt = this.now();
    const validUntil = new Date(observedAt.getTime() + this.validForMs);
    let snapshot: ProviderUsageSnapshot;
    try {
      const credential = await input.resolveCredential();
      if (credential.credentialId !== input.credentialId) throw new Error("credential mismatch");
      const response = await (this.config.fetch ?? globalThis.fetch)("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "chatgpt-account-id": credential.chatgptAccountId,
          accept: "application/json",
        },
      });
      let body: unknown;
      if (response.ok) {
        try { body = await response.json(); } catch { body = undefined; }
      }
      snapshot = parseCodexProviderUsage({
        provider: input.provider,
        credentialId: input.credentialId,
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        body,
        headers: response.headers,
      });
    } catch {
      snapshot = createProviderUsageSnapshot({
        provider: input.provider,
        credentialId: input.credentialId,
        exhaustionReason: null,
        availability: "unknown",
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        source: "unknown",
        confidence: "unknown",
      });
    }
    await this.config.store.put(snapshot);
    return snapshot;
  }
}
