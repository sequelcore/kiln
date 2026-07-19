import type { RuntimeSession } from "../../runtime-session.js";
import type { GovernedRuntimeContext } from "../../runtime-session-orchestrator.types.js";
import type { TurnTemporalContext } from "@kilnai/core";

export function buildRuntimeTurnSystemPrompt(
  session: RuntimeSession,
  governedContext: GovernedRuntimeContext | undefined,
  temporalContext?: TurnTemporalContext,
): string {
  let system = session.systemPrompt;
  if (governedContext?.content) {
    if (governedContext.audit?.governor !== "DefaultContextGovernor") {
      throw new Error("Governed runtime context must include a DefaultContextGovernor audit");
    }
    system += "\n\n--- Governed Context ---\n" + governedContext.content;
  }
  if (temporalContext) {
    system += [
      "",
      "",
      "--- Turn Temporal Context ---",
      `Observed at (UTC): ${temporalContext.observedAt}`,
      `Operator-local date: ${temporalContext.localDate} (${temporalContext.timeZone})`,
      "Use this as the canonical meaning of relative dates such as today and tomorrow. Provider recency alone is not event evidence. Do not substitute a publication or retrieval date for the event date.",
      "",
      "--- Progressive Exact-Date Web Research ---",
      "For claims about an event on an exact date, use a bounded discovery -> verification -> extraction sequence:",
      "1. Start with a broad web_search query containing the event identities and date. Set temporalRequirement to the event date, completed status, and at least two independent sources.",
      "2. Do not copy the event date into startDate or endDate; those fields filter publication dates. Do not invent a domain allowlist. Use exactPhrases only for text that must literally occur, not ordinary entity names.",
      "3. If temporal evidence is insufficient, retry at least once with a materially broader discovery query. Remove only optional constraints you introduced; preserve operator constraints, network policy, and temporalRequirement.",
      "4. Use web_extract on the strongest candidate pages with the same temporalRequirement when snippets do not establish the event date, identities, and completed status.",
      "5. Only synthesize result, chronicle, and causal analysis after evidence is accepted. Otherwise state the evidence gap explicitly.",
    ].join("\n");
  }
  return system;
}
