import { describe, expect, it } from "vitest";
import { presentOperatorEventPayload } from "../src/operator-event-presentation.js";

describe("operator event search result classification", () => {
  it("classifies web/search text output as structured search results before markdown fallback", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-web-search",
      toolName: "web_search",
      output: JSON.stringify({
        output: [
          "5 sources for FIFA World Cup 2026 fixtures July 3 2026 matches",
          "",
          "1. Matches | FIFA World Cup 2026",
          "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
          "",
          "2. FIFA World Cup 2026 | Fixtures, groups, teams & more",
          "[Fixtures](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fixtures)",
        ].join("\n"),
        isError: false,
        metadata: {
          toolName: "web_search",
          kind: "web",
          operation: "search",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "search_results",
      classification: {
        source: "tool-metadata",
      },
      searchResults: [
        {
          title: "Matches | FIFA World Cup 2026",
          url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
        },
        {
          title: "FIFA World Cup 2026 | Fixtures, groups, teams & more",
          url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fixtures",
        },
      ],
    });
    expect(presentation.toolPresentation?.summary).toBe("5 sources for FIFA World Cup 2026 fixtures July 3 2026 matches");
  });
});
