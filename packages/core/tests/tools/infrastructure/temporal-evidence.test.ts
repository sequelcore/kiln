import { describe, expect, it } from "vitest";
import {
  defineTurnTemporalContext,
  evaluateWebSearchTemporalEvidence,
  evaluateTemporalEvidence,
  parseExplicitEventLocalDate,
  resolveWebSearchFreshnessCapability,
} from "../../../src/tools/domain/temporal-evidence.js";

describe("temporal evidence", () => {
  it.each([
    ["el sÃ¡bado 18 de julio de 2026", "2026-07-18"],
    ["Saturday, July 18, 2026", "2026-07-18"],
    ["resultado 2026-07-18", "2026-07-18"],
  ])("parses an explicit event date from %s", (value, expected) => {
    expect(parseExplicitEventLocalDate(value)).toBe(expected);
  });

  it("derives the operator-local date from the trusted turn instant", () => {
    expect(defineTurnTemporalContext({
      observedAt: "2026-07-19T04:45:46.720Z",
      timeZone: "America/Tijuana",
    })).toEqual({
      observedAt: "2026-07-19T04:45:46.720Z",
      timeZone: "America/Tijuana",
      localDate: "2026-07-18",
    });
  });

  it("rejects a historical event when the request requires the operator-local date", () => {
    const context = defineTurnTemporalContext({
      observedAt: "2026-07-19T04:45:46.720Z",
      timeZone: "America/Tijuana",
    });

    expect(evaluateTemporalEvidence({
      context,
      requirement: {
        exactLocalDate: context.localDate,
        requiredIdentityTerms: ["guadalajara", "toluca"],
      },
      observations: [{
        sourceId: "espn:401840883",
        retrievedAt: "2026-07-19T04:45:51.618Z",
        eventLocalDate: "2026-02-28",
        identityTerms: ["guadalajara", "toluca"],
      }],
    })).toEqual({
      accepted: false,
      reason: "event_date_mismatch",
      acceptedSourceIds: [],
      rejectedSourceIds: ["espn:401840883"],
    });
  });

  it("does not treat a provider that ignores recency as satisfying required freshness", () => {
    expect(resolveWebSearchFreshnessCapability({
      provider: "searxng",
      recencyFilter: "ignored",
    }, { required: true })).toEqual({
      accepted: false,
      reason: "freshness_not_enforced",
    });
  });

  it("rejects recent but semantically conflicting event search results", () => {
    expect(evaluateWebSearchTemporalEvidence({
      requirement: {
        exactLocalDate: "2026-07-18",
        requiredIdentityTerms: ["guadalajara", "toluca"],
        eventStatus: "completed",
        minimumIndependentSources: 2,
      },
      retrievedAt: "2026-07-19T05:34:48.312Z",
      sources: [{
        url: "https://www.espn.com.mx/futbol/partido/401877039",
        title: "Guadalajara vs. Toluca (18 de Jul., 2026) Resultados en Vivo",
        snippet: "Guadalajara 0 Toluca 0. Partido programado.",
      }, {
        url: "https://www.chivasdecorazon.com.mx/noticias/previa",
        title: "Todo lo que debes saber del choque entre Chivas y Toluca",
        snippet: "El encuentro se jugará el domingo 19 de julio de 2026.",
      }],
    })).toMatchObject({
      accepted: false,
      reason: "independent_source_consensus_missing",
      acceptedSourceIds: [],
    });
  });

  it("accepts a completed event only when independent sources match date and identities", () => {
    expect(evaluateWebSearchTemporalEvidence({
      requirement: {
        exactLocalDate: "2026-07-18",
        requiredIdentityTerms: ["guadalajara", "toluca"],
        eventStatus: "completed",
        minimumIndependentSources: 2,
      },
      retrievedAt: "2026-07-19T05:34:48.312Z",
      sources: [{
        url: "https://www.espn.com.mx/futbol/partido/401877039",
        title: "Guadalajara 0-2 Toluca (18 de Jul., 2026) Resultado Final",
      }, {
        url: "https://www.tudn.com/futbol/liga-mx/guadalajara-toluca",
        title: "Guadalajara vs Toluca",
        snippet: "Resultado final del 18 de julio de 2026: Guadalajara 0-2 Toluca.",
      }],
    })).toMatchObject({
      accepted: true,
      acceptedSourceIds: [
        "https://www.espn.com.mx/futbol/partido/401877039",
        "https://www.tudn.com/futbol/liga-mx/guadalajara-toluca",
      ],
    });
  });

  it("does not combine unrelated facts scattered across an index page", () => {
    const unrelated = "other fixtures ".repeat(80);
    expect(evaluateWebSearchTemporalEvidence({
      requirement: {
        exactLocalDate: "2026-07-18",
        requiredIdentityTerms: ["guadalajara", "toluca"],
        eventStatus: "completed",
        minimumIndependentSources: 2,
      },
      retrievedAt: "2026-07-19T05:34:48.312Z",
      sources: [{
        url: "https://calendar.example.com/results",
        title: "Resultados finales del 18 de julio de 2026",
        snippet: `${unrelated} Guadalajara and Toluca appear elsewhere in the table.`,
      }, {
        url: "https://other.example.org/results",
        title: "Marcador final del 18 de julio de 2026",
        snippet: `${unrelated} Guadalajara and Toluca appear elsewhere in the table.`,
      }],
    })).toMatchObject({ accepted: false, reason: "independent_source_consensus_missing" });
  });
});
