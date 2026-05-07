import { defaultBuildSystemPrompt, type KilnAppConfig } from "../config.js";
import type { KilnGlobalConfig, KilnGlobalIdentity } from "./global-config.js";

export function buildOperatorIdentityContext(identity: KilnGlobalIdentity | undefined): string | undefined {
  const name = normalizeIdentityValue(identity?.name);
  const timezone = normalizeIdentityValue(identity?.timezone);

  if (!name && !timezone) {
    return undefined;
  }

  return [
    "## Operator Identity",
    "Source: ~/.kiln/config.yaml identity.",
    name ? `- Operator name: ${name}` : undefined,
    timezone ? `- Timezone: ${timezone}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function withGlobalIdentityContext(
  appConfig: KilnAppConfig,
  globalConfig: KilnGlobalConfig | null | undefined,
): KilnAppConfig {
  const identityContext = buildOperatorIdentityContext(globalConfig?.identity);
  if (!identityContext) {
    return appConfig;
  }

  return {
    ...appConfig,
    buildSystemPrompt: (opts) => {
      const basePrompt = (appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt)(opts).trimEnd();
      return basePrompt.length > 0
        ? `${basePrompt}\n\n${identityContext}`
        : identityContext;
    },
  };
}

function normalizeIdentityValue(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
