import {
  diagnoseSecretResolution,
  type ResolvedSecret,
  type SecretDiagnostic,
  type SecretRef,
  type SecretResolver,
} from "@kilnai/core";

export class EnvSecretResolverError extends Error {
  readonly diagnostic: SecretDiagnostic;

  constructor(message: string, diagnostic: SecretDiagnostic) {
    super(message);
    this.name = "EnvSecretResolverError";
    this.diagnostic = diagnostic;
  }
}

export interface EnvSecretResolverConfig {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}

export class EnvSecretResolver implements SecretResolver {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly now: () => Date;

  constructor(config: EnvSecretResolverConfig = {}) {
    this.env = config.env ?? process.env;
    this.now = config.now ?? (() => new Date());
  }

  async resolve(ref: SecretRef): Promise<ResolvedSecret> {
    if (ref.source.kind !== "env") {
      const diagnostic = diagnoseSecretResolution(ref, {
        status: "invalid",
        reason: "env resolver only supports env secret sources",
      }, this.now());
      throw new EnvSecretResolverError(`Unsupported secret source for '${ref.id}'.`, diagnostic);
    }

    const value = this.env[ref.source.name]?.trim();
    if (!value) {
      const diagnostic = diagnoseSecretResolution(ref, {
        status: "missing",
        reason: "environment variable is not set",
      }, this.now());
      throw new EnvSecretResolverError(`Missing secret '${ref.id}' from env source '${ref.source.name}'.`, diagnostic);
    }

    const resolvedAt = this.now().toISOString();
    const diagnostic = diagnoseSecretResolution(ref, {
      status: "available",
      value,
      resolvedAt,
    }, this.now());
    if (diagnostic.status !== "available") {
      throw new EnvSecretResolverError(`Secret '${ref.id}' is not available: ${diagnostic.status}.`, diagnostic);
    }

    return {
      ref,
      value,
      diagnostic,
    };
  }
}
