import { PromptScanner, ToolResultSanitizer } from "@kilnai/core";
import type { EventBus, SafetyPipeline, PromptInjectionConfig } from "@kilnai/core";

interface RuntimeToolResultSanitizerDeps {
  readonly safetyPipeline?: SafetyPipeline;
  readonly eventBus?: EventBus;
  readonly promptInjectionConfig?: PromptInjectionConfig;
}

export function createRuntimeToolResultSanitizer(
  deps: RuntimeToolResultSanitizerDeps,
): ToolResultSanitizer | undefined {
  if (!deps.safetyPipeline) return undefined;
  const promptScanner = deps.promptInjectionConfig?.enabled
    ? new PromptScanner(deps.promptInjectionConfig)
    : undefined;
  return new ToolResultSanitizer({
    pipeline: deps.safetyPipeline,
    promptScanner,
    eventBus: deps.eventBus,
  });
}
