import { defaultBuildSystemPrompt, type KilnAppConfig } from "../config.js";
import type { KilnGlobalConfig, KilnGlobalIdentity } from "./global-config.js";
import type { ContextCandidate } from "@kilnai/core";

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

export function buildOperatorIdentityContextCandidate(
  identity: KilnGlobalIdentity | undefined,
): ContextCandidate | undefined {
  const content = buildOperatorIdentityContext(identity);
  if (!content) {
    return undefined;
  }
  return {
    kind: "instruction",
    source: "operator-identity:~/.kiln/config.yaml#identity",
    content,
    required: true,
    score: 1,
  };
}

export function withGlobalIdentityContext(
  appConfig: KilnAppConfig,
  globalConfig: KilnGlobalConfig | null | undefined,
): KilnAppConfig {
  const identityCandidate = buildOperatorIdentityContextCandidate(globalConfig?.identity);
  if (!identityCandidate) {
    return appConfig;
  }

  return {
    ...appConfig,
    ...(globalConfig?.identity?.timezone ? { operatorTimeZone: globalConfig.identity.timezone.trim() } : {}),
    buildSystemPrompt: appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt,
    contextCandidates: [
      ...(appConfig.contextCandidates ?? []),
      identityCandidate,
    ],
  };
}

function normalizeIdentityValue(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
