import { describe, expect, it } from "vitest";
import { extractText, textParts } from "@kilnai/core/engine";
import {
  assessRuntimeTemporalEvidence,
  shouldRequestTemporalEvidenceRecovery,
  temporalEvidenceRecoveryInstruction,
} from "../../src/session/support/context/runtime-temporal-evidence-guard.js";

const context = {
  observedAt: "2026-07-19T05:34:42.733Z",
  timeZone: "America/Tijuana",
  localDate: "2026-07-18",
} as const;

describe("runtime temporal evidence guard", () => {
  it("rejects an exact-day event answer when search only proves recency", () => {
    expect(assessRuntimeTemporalEvidence({
      userParts: textParts("Hoy, ¿cuál fue el resultado de Chivas vs Toluca?"),
      temporalContext: context,
      toolExecutions: [{
        toolName: "web_search",
        durationMs: 10,
        success: true,
        resultSummary: "Recent sources",
        metadata: {
          freshnessRequired: true,
          freshnessEnforcement: "enforced",
        },
      }],
    })).toMatchObject({ required: true, accepted: false });
  });

  it("accepts only evidence bound to the current local date", () => {
    expect(assessRuntimeTemporalEvidence({
      userParts: textParts("¿Por qué perdió Chivas contra Toluca hoy?"),
      temporalContext: context,
      toolExecutions: [{
        toolName: "web_search",
        durationMs: 10,
        success: true,
        resultSummary: "Verified sources",
        metadata: {
          temporalRequirement: {
            exactLocalDate: "2026-07-18",
            requiredIdentityTerms: ["guadalajara", "toluca"],
            eventStatus: "completed",
            minimumIndependentSources: 2,
          },
          temporalEvidence: {
            accepted: true,
            acceptedSourceIds: ["https://espn.com.mx/match", "https://tudn.com/match"],
            rejectedSourceIds: [],
          },
        },
      }],
    })).toEqual({ required: true, accepted: true, exactLocalDate: "2026-07-18" });
  });

  it("requires evidence bound to an explicit event date rather than only relative dates", () => {
    expect(assessRuntimeTemporalEvidence({
      userParts: textParts("Por que perdio Chivas contra Toluca el sabado 18 de julio de 2026?"),
      temporalContext: {
        observedAt: "2026-07-20T05:34:42.733Z",
        timeZone: "America/Tijuana",
        localDate: "2026-07-19",
      },
      toolExecutions: [],
    })).toEqual({ required: true, accepted: false, exactLocalDate: "2026-07-18" });
  });

  it("accepts explicit-date evidence only when it matches the date in the request", () => {
    expect(assessRuntimeTemporalEvidence({
      userParts: textParts("Por que perdio Chivas contra Toluca el 18 de julio de 2026?"),
      temporalContext: {
        observedAt: "2026-07-20T05:34:42.733Z",
        timeZone: "America/Tijuana",
        localDate: "2026-07-19",
      },
      toolExecutions: [{
        toolName: "web_extract",
        durationMs: 10,
        success: true,
        resultSummary: "Verified pages",
        metadata: {
          temporalRequirement: {
            exactLocalDate: "2026-07-18",
            requiredIdentityTerms: ["chivas", "toluca"],
            eventStatus: "completed",
            minimumIndependentSources: 2,
          },
          temporalEvidence: {
            accepted: true,
            acceptedSourceIds: ["https://one.example/match", "https://two.example/match"],
            rejectedSourceIds: [],
          },
        },
      }],
    })).toEqual({ required: true, accepted: true, exactLocalDate: "2026-07-18" });
  });

  it("requests one bounded recovery round after an insufficient temporal search", () => {
    const assessment = { required: true, accepted: false, exactLocalDate: "2026-07-18" } as const;
    const toolExecutions = [{
      toolName: "web_search",
      durationMs: 10,
      success: false,
      resultSummary: "Insufficient evidence",
      metadata: {
        recoveryDirective: {
          kind: "progressive_web_research",
          action: "broaden_search",
        },
      },
    }];

    expect(shouldRequestTemporalEvidenceRecovery(assessment, toolExecutions, false)).toBe(true);
    expect(shouldRequestTemporalEvidenceRecovery(assessment, toolExecutions, true)).toBe(false);
    expect(extractText(temporalEvidenceRecoveryInstruction(assessment))).toContain("broader web_search");
    expect(extractText(temporalEvidenceRecoveryInstruction(assessment))).toContain("2026-07-18");
  });
});
