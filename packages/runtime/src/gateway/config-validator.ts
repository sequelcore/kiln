import { KilnError } from "@kilnai/core";

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: readonly { field: string; message: string }[];
}

/**
 * Validate all required configuration at gateway startup.
 * Checks environment variables, config values, and service URLs.
 * Returns all errors at once -- does not fail on first error.
 */
export function validateStartupConfig(config: {
  providerAdapterApps?: readonly { provider: string; apiKeyEnv: string }[];
  whatsapp?: { verifyTokenEnv: string; accessTokenEnv: string };
  tenantAdmin?: { adminTokenEnv: string };
}): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  // Validate app provider API keys for provider-adapter apps
  if (config.providerAdapterApps) {
    for (const providerAdapterApp of config.providerAdapterApps) {
      if (providerAdapterApp.apiKeyEnv) {
        const value = process.env[providerAdapterApp.apiKeyEnv];
        if (!value || value.trim() === "") {
          errors.push({
            field: `providerAdapterApps.${providerAdapterApp.provider}.apiKeyEnv`,
            message: `Environment variable '${providerAdapterApp.apiKeyEnv}' is required but not set`,
          });
        }
      }
    }
  }

  // Validate WhatsApp configuration if present
  if (config.whatsapp) {
    const verifyValue = process.env[config.whatsapp.verifyTokenEnv];
    if (!verifyValue || verifyValue.trim() === "") {
      errors.push({
        field: "whatsapp.verifyTokenEnv",
        message: `Environment variable '${config.whatsapp.verifyTokenEnv}' is required but not set`,
      });
    }

    const accessValue = process.env[config.whatsapp.accessTokenEnv];
    if (!accessValue || accessValue.trim() === "") {
      errors.push({
        field: "whatsapp.accessTokenEnv",
        message: `Environment variable '${config.whatsapp.accessTokenEnv}' is required but not set`,
      });
    }
  }

  // Validate tenant admin configuration if present
  if (config.tenantAdmin) {
    const adminValue = process.env[config.tenantAdmin.adminTokenEnv];
    if (!adminValue || adminValue.trim() === "") {
      errors.push({
        field: "tenantAdmin.adminTokenEnv",
        message: `Environment variable '${config.tenantAdmin.adminTokenEnv}' is required but not set`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate startup config and throw if invalid.
 * Call this during gateway startup before creating providers.
 */
export function assertValidStartupConfig(config: Parameters<typeof validateStartupConfig>[0]): void {
  const result = validateStartupConfig(config);
  if (!result.valid) {
    throw new KilnError(
      "CONFIG_MISSING_ENV",
      `Startup configuration invalid:\n${result.errors.map((e) => `  ${e.field}: ${e.message}`).join("\n")}`,
      {
        context: { errors: result.errors },
        retryable: false,
      }
    );
  }
}
