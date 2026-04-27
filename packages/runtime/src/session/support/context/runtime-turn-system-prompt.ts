import type { RuntimeSession } from "../../runtime-session.js";
import type { GovernedRuntimeContext } from "../../runtime-session-orchestrator.types.js";

export function buildRuntimeTurnSystemPrompt(
  session: RuntimeSession,
  governedContext: GovernedRuntimeContext | undefined,
): string {
  let system = session.systemPrompt;
  if (governedContext?.content) {
    if (governedContext.audit?.governor !== "DefaultContextGovernor") {
      throw new Error("Governed runtime context must include a DefaultContextGovernor audit");
    }
    system += "\n\n--- Governed Context ---\n" + governedContext.content;
  }
  return system;
}
