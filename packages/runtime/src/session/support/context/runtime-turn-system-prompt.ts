import type { RuntimeSession } from "../../runtime-session.js";
import type { PerCallToolConfig } from "../../runtime-session-orchestrator.types.js";

export function buildRuntimeTurnSystemPrompt(
  session: RuntimeSession,
  recalledMemory: string | undefined,
  perCallConfig: PerCallToolConfig | undefined,
): string {
  let system = session.systemPrompt;
  if (recalledMemory) {
    system += "\n\n--- Recalled Memory ---\n" + recalledMemory;
  }
  if (perCallConfig?.skillInstructions) {
    system += "\n\n--- Active Skills ---\n" + perCallConfig.skillInstructions;
  }
  return system;
}
