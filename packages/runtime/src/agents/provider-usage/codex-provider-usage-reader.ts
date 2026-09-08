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
  /** One-shot recovery after a provider 401; the owner enforces its fence. */
  readonly refreshCredential?: (rejectedCredential: ResolvedCodexUsageCredential) => Promise<ResolvedCodexUsageCredential>;
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

    // Resolved separately from the request so an unusable credential is not
    // reported as a failed request; the two need different operator action.
    let credential: ResolvedCodexUsageCredential;
    try {
      credential = await input.resolveCredential();
      if (credential.credentialId !== input.credentialId) throw new Error("credential mismatch");
    } catch {
      const unavailable = this.unobserved(input, observedAt, validUntil, "credential-unavailable");
      await this.config.store.put(unavailable);
      return unavailable;
    }

    // Only the exchange itself is guarded here. Interpreting the answer is
    // guarded separately below, so a Kiln parsing defect or a provider contract
    // change is never reported as an unreachable provider.
    let response: Response | undefined;
    let body: unknown;
    const request = async (candidate: ResolvedCodexUsageCredential): Promise<Response | undefined> => {
      try {
        return await (this.config.fetch ?? globalThis.fetch)("https://chatgpt.com/backend-api/wham/usage", {
          method: "GET",
          headers: {
            authorization: `Bearer ${candidate.accessToken}`,
            "chatgpt-account-id": candidate.chatgptAccountId,
            accept: "application/json",
          },
        });
      } catch {
        // No response was received, so no status exists to report.
        return undefined;
      }
    };
    response = await request(credential);
    if (response?.status === 401 && input.refreshCredential) {
      try {
        const refreshed = await input.refreshCredential(credential);
        if (refreshed.credentialId !== input.credentialId) throw new Error("credential mismatch");
        if (refreshed.chatgptAccountId !== credential.chatgptAccountId) throw new Error("account mismatch");
        credential = refreshed;
        response = await request(credential);
      } catch {
        // Keep the original 401 as terminal evidence when recovery is rejected.
      }
    }
    if (response === undefined) {
      snapshot = this.unobserved(input, observedAt, validUntil, "provider-request-failed");
      await this.config.store.put(snapshot);
      return snapshot;
    }
    if (response.ok) {
      try { body = await response.json(); } catch { body = undefined; }
    }

    try {
      snapshot = parseCodexProviderUsage({
        provider: input.provider,
        credentialId: input.credentialId,
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        body,
        headers: response.headers,
        // A rejected response may still carry authoritative rate-limit headers,
        // so this only classifies the terminal fallback.
        ...(response.ok ? {} : { failure: { httpStatus: response.status } }),
      });
    } catch {
      snapshot = this.unobserved(
        input,
        observedAt,
        validUntil,
        "provider-response-unusable",
        response.status,
      );
    }
    await this.config.store.put(snapshot);
    return snapshot;
  }

  /** Absent usage that was never observed, which never means unconsumed. */
  private unobserved(
    input: ReadCodexProviderUsageInput,
    observedAt: Date,
    validUntil: Date,
    source: "provider-request-failed" | "credential-unavailable" | "provider-response-unusable",
    httpStatus?: number,
  ): ProviderUsageSnapshot {
    return createProviderUsageSnapshot({
      provider: input.provider,
      credentialId: input.credentialId,
      exhaustionReason: null,
      availability: "unknown",
      observedAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      source,
      confidence: "unknown",
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  }
}
