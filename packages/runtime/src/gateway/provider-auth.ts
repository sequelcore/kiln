import {
  CODEX_DEVICE_VERIFICATION_URI,
  CodexOAuthAuth,
  type OpenCodeTier,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  OpenCodeCredentialPoolService,
} from "../agents/credential-pool/index.js";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import type {
  GuiInboundFrame,
  GuiProviderAuthDeviceCodeStarted,
  GuiProviderAuthMethod,
} from "@kilnai/gateway-contracts";

export interface ProviderAuthRequest {
  readonly provider?: unknown;
  readonly requestId?: unknown;
  readonly apiKey?: unknown;
  readonly tier?: unknown;
}

export interface ProviderAuthStartResult {
  readonly ok: true;
  readonly provider: string;
  readonly requestId: string;
  readonly method: GuiProviderAuthMethod;
  readonly started?: GuiProviderAuthDeviceCodeStarted;
  complete(): Promise<void>;
}

export type ProviderAuthResult =
  | ProviderAuthStartResult
  | { readonly ok: false; readonly provider: string; readonly requestId: string; readonly error: string };

function providerAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[provider-auth][debug] ${message}`, context ?? {});
}

export function isProviderAuthCompletedFrame(frame: GuiInboundFrame): frame is Extract<GuiInboundFrame, { type: "provider_auth_completed" }> {
  return frame.type === "provider_auth_completed";
}

export async function startProviderAuthRequest(
  request: ProviderAuthRequest,
): Promise<ProviderAuthResult> {
  const provider = typeof request.provider === "string" ? request.provider.trim() : "";
  const requestId = typeof request.requestId === "string" ? request.requestId.trim() : "";
  providerAuthDebug("received provider auth request", {
    provider,
    requestId,
    hasApiKey: typeof request.apiKey === "string" && request.apiKey.trim().length > 0,
    tier: request.tier,
  });
  if (!provider) {
    return { ok: false, provider, requestId, error: "Provider auth request must include a provider id" };
  }
  if (!requestId) {
    return { ok: false, provider, requestId, error: "Provider auth requestId is required" };
  }

  const metadata = getGuiProviderMetadata(provider);
  providerAuthDebug("resolved provider auth metadata", {
    provider,
    requestId,
    hasMetadata: Boolean(metadata),
    authMethod: metadata?.authMethod,
    authTier: metadata?.authTier,
  });
  if (!metadata?.authMethod) {
    return { ok: false, provider, requestId, error: `Provider '${provider}' does not support interactive authentication` };
  }

  if (metadata.authMethod === "device_code") {
    const auth = new CodexOAuthAuth();
    const authorization = await auth.startDeviceAuthorization();
    providerAuthDebug("device-code auth started", {
      provider,
      requestId,
      intervalSeconds: authorization.intervalSeconds,
      verificationUri: CODEX_DEVICE_VERIFICATION_URI,
      hasUserCode: authorization.userCode.trim().length > 0,
    });
    return {
      ok: true,
      provider,
      requestId,
      method: "device_code",
      started: {
        type: "provider_auth_started",
        provider,
        requestId,
        method: "device_code",
        verificationUri: CODEX_DEVICE_VERIFICATION_URI,
        userCode: authorization.userCode,
        message: "Complete Codex sign-in in the browser, then return to Kiln.",
      },
      complete: async () => {
        providerAuthDebug("device-code auth completion started", {
          provider,
          requestId,
        });
        const tokenFile = await auth.pollForAuthorization({
          deviceAuthId: authorization.deviceAuthId,
          userCode: authorization.userCode,
          intervalSeconds: authorization.intervalSeconds,
        });
        providerAuthDebug("device-code token received", {
          provider,
          requestId,
          expiresAt: tokenFile.expires_at,
          hasAccessToken: tokenFile.access_token.trim().length > 0,
          hasRefreshToken: tokenFile.refresh_token.trim().length > 0,
        });
        await new CodexOAuthCredentialPoolService().linkCredential({ tokenFile });
        providerAuthDebug("device-code auth completion saved token", {
          provider,
          requestId,
        });
      },
    };
  }

  const apiKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
  if (!apiKey) {
    return { ok: false, provider, requestId, error: `${metadata.label} requires an API key.` };
  }

  const tier = resolveOpenCodeTier(provider, request.tier, metadata.authTier);
  providerAuthDebug("api-key auth accepted", {
    provider,
    requestId,
    tier,
  });
  return {
    ok: true,
    provider,
    requestId,
    method: "api_key",
    complete: async () => {
      providerAuthDebug("api-key auth saving credentials", {
        provider,
        requestId,
        tier,
      });
      await new OpenCodeCredentialPoolService().linkCredential({
        apiKey,
        tier,
        createdAt: new Date().toISOString(),
      });
      providerAuthDebug("api-key auth saved credentials", {
        provider,
        requestId,
        tier,
      });
    },
  };
}

function resolveOpenCodeTier(
  provider: string,
  requestedTier: unknown,
  metadataTier: OpenCodeTier | undefined,
): OpenCodeTier {
  if (requestedTier === "zen") return "zen";
  if (requestedTier === "go") return "go";
  if (metadataTier) return metadataTier;
  return provider === "opencode-zen" ? "zen" : "go";
}
