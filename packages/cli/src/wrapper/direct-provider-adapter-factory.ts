import {
  type DirectProviderId,
  type ExecutionSessionBindingEvidence,
  type ProviderAdapter,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  DirectProviderCredentialPoolService,
  OpenCodeCredentialPoolService,
  type ConfiguredExecutionCredential,
  type OpenCodeTier,
  isPooledDirectProviderId,
} from "@kilnai/runtime";

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface DirectProviderCredentialBinding {
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialId: string;
  /** Exact persisted credential revision committed before provider dispatch. */
  readonly credentialRevision: string;
}

export type DirectProviderExecutionBindingEvidence = Extract<
  ExecutionSessionBindingEvidence,
  { readonly status: "bound" }
>;

export class DirectProviderBindingError extends Error {
  readonly evidence: Extract<ExecutionSessionBindingEvidence, { readonly status: "rejected-pre-dispatch" }>;

  constructor(binding: DirectProviderCredentialBinding) {
    super(`Exact credential binding for route '${binding.routeId}' was rejected before dispatch.`);
    this.name = "DirectProviderBindingError";
    this.evidence = {
      status: "rejected-pre-dispatch",
      routeId: binding.routeId,
      accountId: binding.accountId,
      credentialId: binding.credentialId,
    };
  }
}

export type BoundDirectProviderAdapter = ProviderAdapter & {
  readonly executionBinding: DirectProviderExecutionBindingEvidence;
};

export function directProviderExecutionBinding(
  adapter: ProviderAdapter,
): DirectProviderExecutionBindingEvidence | undefined {
  const candidate = Reflect.get(adapter, "executionBinding") as unknown;
  if (!candidate || typeof candidate !== "object") return undefined;
  const binding = candidate as Record<string, unknown>;
  return binding.status === "bound"
    && typeof binding.routeId === "string"
    && typeof binding.accountId === "string"
    && typeof binding.credentialId === "string"
    && isNonBlankRevision(binding.credentialRevision)
    ? {
        status: "bound",
        routeId: binding.routeId,
        accountId: binding.accountId,
        credentialId: binding.credentialId,
        credentialRevision: binding.credentialRevision,
      }
    : undefined;
}

export interface DirectProviderAdapterOptions {
  readonly provider: DirectProviderId;
  readonly model?: string;
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly credentialBinding?: DirectProviderCredentialBinding;
  /** Credential material resolved after the operator dispatch fence. */
  readonly executionCredential?: ConfiguredExecutionCredential;
  readonly configEnv?: EnvMap;
  readonly runtimeEnv?: EnvMap;
  readonly processEnv?: EnvMap;
}

interface DirectProviderAdapterContext {
  readonly provider: DirectProviderId;
  readonly model?: string;
  readonly kilnHome?: string;
  readonly credentialBinding?: DirectProviderCredentialBinding;
  readonly executionCredential?: ConfiguredExecutionCredential;
  readonly resolveEnv: (name: string) => string | undefined;
}

type DirectProviderAdapterDefinition = {
  readonly create: (context: DirectProviderAdapterContext) => ProviderAdapter | Promise<ProviderAdapter>;
};

function requireSelectedModel(context: DirectProviderAdapterContext): string {
  const model = context.model?.trim();
  if (!model) {
    throw new Error(`Direct provider '${context.provider}' requires a non-empty configured model`);
  }
  return model;
}

const DIRECT_PROVIDER_ADAPTERS: Readonly<Record<DirectProviderId, DirectProviderAdapterDefinition>> = {
  "codex-oauth": {
    create: createCodexOAuthAdapter,
  },
  anthropic: {
    create: createBoundDirectProviderAdapter,
  },
  openai: {
    create: createBoundDirectProviderAdapter,
  },
  deepseek: {
    create: createBoundDirectProviderAdapter,
  },
  openrouter: {
    create: createBoundDirectProviderAdapter,
  },
  ollama: {
    create: createBoundDirectProviderAdapter,
  },
  lmstudio: {
    create: createBoundDirectProviderAdapter,
  },
  "opencode-go": {
    create: (context) => createOpenCodeAdapter("go", context),
  },
  "opencode-zen": {
    create: (context) => createOpenCodeAdapter("zen", context),
  },
};

export async function createDirectProviderAdapter(
  options: DirectProviderAdapterOptions,
): Promise<ProviderAdapter> {
  const definition = DIRECT_PROVIDER_ADAPTERS[options.provider];
  if (!definition) {
    throw new Error(`Unsupported direct provider: ${options.provider}`);
  }
  if (options.credentialBinding
    && !options.executionCredential
    && !supportsExactCredentialBinding(options.provider)) {
    throw new Error(`Direct provider '${options.provider}' does not support exact credential binding.`);
  }
  if (options.executionCredential && !options.credentialBinding) {
    throw new Error("A committed execution credential requires an exact binding.");
  }

  const processEnv = options.processEnv ?? process.env;
  const resolveEnv = (name: string): string | undefined =>
    options.runtimeEnv?.[name] ?? options.configEnv?.[name] ?? processEnv[name];
  return await definition.create({
    provider: options.provider,
    model: options.model,
    kilnHome: options.kilnHome,
    credentialBinding: options.credentialBinding,
    executionCredential: options.executionCredential,
    resolveEnv,
  });
}

async function createCodexOAuthAdapter(
  context: DirectProviderAdapterContext,
): Promise<ProviderAdapter> {
  const service = new CodexOAuthCredentialPoolService({ kilnHome: context.kilnHome });
  const defaultModel = requireSelectedModel(context);
  if (!context.credentialBinding) {
    if (context.executionCredential) {
      throw new Error("A committed execution credential requires an exact binding.");
    }
    throw new Error("Provider dispatch requires an exact committed execution credential binding.");
  }
  const committedRevision = requireCommittedRevision(context.credentialBinding);
  if (context.executionCredential) {
    assertCommittedCredential(context.provider, context.credentialBinding, context.executionCredential);
    if (context.provider !== "codex-oauth" || "providerId" in context.executionCredential) {
      throw new DirectProviderBindingError(context.credentialBinding);
    }
    const adapter = await service.createAdapterFromCredential({
      credential: context.executionCredential,
      defaultModel,
    });
    return Object.assign(adapter, {
      executionBinding: boundExecutionEvidence(context.credentialBinding, committedRevision),
    } satisfies Pick<BoundDirectProviderAdapter, "executionBinding">);
  }
  const selected = (await service.listExecutionAccounts()).find(
    (account) => account.credentialId === context.credentialBinding!.credentialId,
  );
  if (!selected || !matchesExactCommittedRevision(selected.revision, context.credentialBinding)) {
    throw new DirectProviderBindingError(context.credentialBinding);
  }
  let adapter: ProviderAdapter;
  try {
    adapter = await service.createExactAdapter({
      selected,
      defaultModel,
    });
  } catch {
    throw new DirectProviderBindingError(context.credentialBinding);
  }
  return Object.assign(adapter, {
    executionBinding: boundExecutionEvidence(context.credentialBinding, selected.revision),
  } satisfies Pick<BoundDirectProviderAdapter, "executionBinding">);
}

async function createBoundDirectProviderAdapter(
  context: DirectProviderAdapterContext,
): Promise<ProviderAdapter> {
  if (!isPooledDirectProviderId(context.provider)) {
    throw new Error(`Unsupported pooled direct provider: ${context.provider}`);
  }
  const service = new DirectProviderCredentialPoolService({
    kilnHome: context.kilnHome,
    env: {
      ANTHROPIC_API_KEY: context.resolveEnv("ANTHROPIC_API_KEY"),
      OPENAI_API_KEY: context.resolveEnv("OPENAI_API_KEY"),
      DEEPSEEK_API_KEY: context.resolveEnv("DEEPSEEK_API_KEY"),
      OPENROUTER_API_KEY: context.resolveEnv("OPENROUTER_API_KEY"),
      OLLAMA_BASE_URL: context.resolveEnv("OLLAMA_BASE_URL"),
      LMSTUDIO_API_KEY: context.resolveEnv("LMSTUDIO_API_KEY"),
      LMSTUDIO_BASE_URL: context.resolveEnv("LMSTUDIO_BASE_URL"),
    },
  });
  if (!context.credentialBinding || !context.executionCredential
    || !isDirectExecutionCredential(context.executionCredential, context.provider)) {
    throw new Error("Provider dispatch requires an exact committed execution credential binding.");
  }
  assertCommittedCredential(context.provider, context.credentialBinding, context.executionCredential);
  const adapter = await service.createAdapterFromCredential({
    credential: context.executionCredential,
    defaultModel: context.model,
    openRouterAppUrl: context.resolveEnv("OPENROUTER_APP_URL"),
    openRouterAppName: context.resolveEnv("OPENROUTER_APP_NAME"),
  });
  return Object.assign(adapter, {
    executionBinding: boundExecutionEvidence(context.credentialBinding, requireCommittedRevision(context.credentialBinding)),
  } satisfies Pick<BoundDirectProviderAdapter, "executionBinding">);
}

async function createOpenCodeAdapter(
  tier: OpenCodeTier,
  context: DirectProviderAdapterContext,
): Promise<ProviderAdapter> {
  if (context.credentialBinding) {
    const defaultModel = requireSelectedModel(context);
    const committedRevision = requireCommittedRevision(context.credentialBinding);
    const service = new OpenCodeCredentialPoolService({ kilnHome: context.kilnHome });
    if (context.executionCredential) {
      if (!isOpenCodeExecutionCredential(context.executionCredential, context.provider)) {
        throw new DirectProviderBindingError(context.credentialBinding);
      }
      assertCommittedCredential(context.provider, context.credentialBinding, context.executionCredential);
      const adapter = await service.createAdapterFromCredential({
        credential: context.executionCredential,
        defaultModel,
      });
      return Object.assign(adapter, {
        executionBinding: boundExecutionEvidence(context.credentialBinding, committedRevision),
      } satisfies Pick<BoundDirectProviderAdapter, "executionBinding">);
    }
    const selected = (await service.listExecutionAccounts(tier)).find(
      (account) => account.credentialId === context.credentialBinding!.credentialId,
    );
    if (!selected || !matchesExactCommittedRevision(selected.revision, context.credentialBinding)) {
      throw new DirectProviderBindingError(context.credentialBinding);
    }
    let adapter: ProviderAdapter;
    try {
      adapter = await service.createExactAdapter({ selected, defaultModel });
    } catch {
      throw new DirectProviderBindingError(context.credentialBinding);
    }
    return Object.assign(adapter, {
      executionBinding: boundExecutionEvidence(context.credentialBinding, selected.revision),
    } satisfies Pick<BoundDirectProviderAdapter, "executionBinding">);
  }

  throw new Error("Provider dispatch requires an exact committed execution credential binding.");
}

function supportsExactCredentialBinding(provider: DirectProviderId): boolean {
  return provider === "codex-oauth" || provider === "opencode-go" || provider === "opencode-zen";
}

function assertCommittedCredential(
  provider: DirectProviderId,
  binding: DirectProviderCredentialBinding,
  credential: ConfiguredExecutionCredential,
): void {
  if (credential.credentialId !== binding.credentialId || !isNonBlankRevision(binding.credentialRevision)) {
    throw new DirectProviderBindingError(binding);
  }
  if ("providerId" in credential && credential.providerId !== provider) {
    throw new DirectProviderBindingError(binding);
  }
  if (!("providerId" in credential) && provider !== "codex-oauth") {
    throw new DirectProviderBindingError(binding);
  }
}

function requireCommittedRevision(binding: DirectProviderCredentialBinding): string {
  if (!isNonBlankRevision(binding.credentialRevision)) {
    throw new DirectProviderBindingError(binding);
  }
  return binding.credentialRevision;
}

function isDirectExecutionCredential(
  credential: ConfiguredExecutionCredential,
  provider: DirectProviderId,
): credential is Extract<ConfiguredExecutionCredential, {
  readonly providerId: "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama" | "lmstudio";
}> {
  return "providerId" in credential && credential.providerId === provider;
}

function isOpenCodeExecutionCredential(
  credential: ConfiguredExecutionCredential,
  provider: DirectProviderId,
): credential is Extract<ConfiguredExecutionCredential, { readonly providerId: "opencode-go" | "opencode-zen" }> {
  return (provider === "opencode-go" || provider === "opencode-zen")
    && "providerId" in credential
    && credential.providerId === provider;
}

function matchesExactCommittedRevision(
  selectedRevision: string,
  binding: DirectProviderCredentialBinding,
): boolean {
  return isNonBlankRevision(binding.credentialRevision) && binding.credentialRevision === selectedRevision;
}

function isNonBlankRevision(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function boundExecutionEvidence(
  binding: DirectProviderCredentialBinding,
  credentialRevision: string,
): DirectProviderExecutionBindingEvidence {
  return {
    status: "bound",
    routeId: binding.routeId,
    accountId: binding.accountId,
    credentialId: binding.credentialId,
    credentialRevision,
  };
}
