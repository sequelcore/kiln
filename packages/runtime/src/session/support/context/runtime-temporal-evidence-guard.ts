import {
  extractText,
  parseExplicitEventLocalDate,
  textParts,
  type ContentPart,
  type TurnTemporalContext,
} from "@kilnai/core";
import type { ToolExecutionSummary } from "../../runtime-session-orchestrator.types.js";

export type RuntimeTemporalEvidenceAssessment =
  | { readonly required: false; readonly accepted: true }
  | { readonly required: true; readonly accepted: true; readonly exactLocalDate: string }
  | { readonly required: true; readonly accepted: false; readonly exactLocalDate: string };

export function assessRuntimeTemporalEvidence(input: {
  readonly userParts: readonly ContentPart[];
  readonly temporalContext?: TurnTemporalContext;
  readonly toolExecutions: readonly ToolExecutionSummary[];
}): RuntimeTemporalEvidenceAssessment {
  if (!input.temporalContext) {
    return { required: false, accepted: true };
  }
  const exactLocalDate = requiredEventEvidenceDate(extractText(input.userParts), input.temporalContext.localDate);
  if (!exactLocalDate) return { required: false, accepted: true };
  const accepted = input.toolExecutions.some((execution) => {
    if ((execution.toolName !== "web_search" && execution.toolName !== "web_extract") || !execution.success) return false;
    const requirement = readRecord(execution.metadata?.temporalRequirement);
    const evidence = readRecord(execution.metadata?.temporalEvidence);
    return requirement?.exactLocalDate === exactLocalDate
      && requirement?.eventStatus === "completed"
      && typeof requirement.minimumIndependentSources === "number"
      && requirement.minimumIndependentSources >= 2
      && evidence?.accepted === true
      && Array.isArray(evidence.acceptedSourceIds)
      && evidence.acceptedSourceIds.length >= requirement.minimumIndependentSources;
  });
  return { required: true, accepted, exactLocalDate };
}

export function temporalEvidenceRefusal(context: TurnTemporalContext, exactLocalDate = context.localDate): readonly ContentPart[] {
  return textParts(
    `Kiln no pudo verificar con al menos dos fuentes independientes que el evento ocurrió y concluyó el ${exactLocalDate} en ${context.timeZone}. `
    + "Por seguridad, no afirmaré un resultado ni atribuiré causas hasta contar con evidencia coincidente de la fecha, participantes y estado final.",
  );
}

export function shouldRequestTemporalEvidenceRecovery(
  assessment: RuntimeTemporalEvidenceAssessment,
  toolExecutions: readonly ToolExecutionSummary[],
  recoveryAlreadyRequested: boolean,
): boolean {
  if (recoveryAlreadyRequested || !assessment.required || assessment.accepted) return false;
  return toolExecutions.some((execution) => {
    const directive = readRecord(execution.metadata?.recoveryDirective);
    return execution.toolName === "web_search"
      && directive?.kind === "progressive_web_research"
      && directive.action === "broaden_search";
  });
}

export function temporalEvidenceRecoveryInstruction(
  assessment: Extract<RuntimeTemporalEvidenceAssessment, { readonly required: true }>,
): readonly ContentPart[] {
  return textParts(
    `Exact-date evidence for ${assessment.exactLocalDate} is still insufficient. Do not answer yet. `
    + "Run one broader web_search using the same temporalRequirement. Remove only optional constraints you introduced; preserve operator constraints and network policy. "
    + "Do not copy the event date into publication-date filters. Then use web_extract on the strongest candidate pages when snippets remain insufficient.",
  );
}

function requiredEventEvidenceDate(value: string, operatorLocalDate: string): string | undefined {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US");
  const relativeDate = /\b(hoy|today|esta noche|tonight|esta manana|this morning)\b/u.test(normalized);
  const eventClaim = /\b(resultado|result|marcador|score|partido|match|evento|event|ocurrio|happened|perdio|lost|gano|won|empato|draw|programado|scheduled)\b/u.test(normalized);
  if (!eventClaim) return undefined;
  return parseExplicitEventLocalDate(value) ?? (relativeDate ? operatorLocalDate : undefined);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
