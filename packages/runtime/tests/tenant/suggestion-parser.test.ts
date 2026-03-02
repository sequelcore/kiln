import { describe, it, expect } from "vitest";
import { extractSuggestions, stripSuggestionTags } from "../../src/tenant/suggestion-parser.js";

describe("extractSuggestions", () => {
  it("returns content and empty suggestions when no SUGG tags present", () => {
    const result = extractSuggestions("Hello, how can I help you?");
    expect(result.content).toBe("Hello, how can I help you?");
    expect(result.suggestions).toEqual([]);
  });

  it("extracts suggestions from SUGG tags at end of text", () => {
    const text = "We offer haircuts and coloring.\n<<SUGG>>How much is a haircut?|Do you take walk-ins?|What are your hours?<</SUGG>>";
    const result = extractSuggestions(text);
    expect(result.content).toBe("We offer haircuts and coloring.");
    expect(result.suggestions).toEqual([
      "How much is a haircut?",
      "Do you take walk-ins?",
      "What are your hours?",
    ]);
  });

  it("trims whitespace from suggestions", () => {
    const text = "Response text\n<<SUGG>> Q1 | Q2 | Q3 <</SUGG>>";
    const result = extractSuggestions(text);
    expect(result.suggestions).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("filters out empty suggestions", () => {
    const text = "Response text\n<<SUGG>>Q1||Q2<</SUGG>>";
    const result = extractSuggestions(text);
    expect(result.suggestions).toEqual(["Q1", "Q2"]);
  });

  it("handles trailing whitespace after SUGG block", () => {
    const text = "Response text\n<<SUGG>>Q1|Q2<</SUGG>>  \n";
    const result = extractSuggestions(text);
    expect(result.content).toBe("Response text");
    expect(result.suggestions).toEqual(["Q1", "Q2"]);
  });
});

describe("stripSuggestionTags", () => {
  it("removes SUGG tags from text", () => {
    const text = "Hello there.\n<<SUGG>>Q1|Q2<</SUGG>>";
    expect(stripSuggestionTags(text)).toBe("Hello there.");
  });

  it("returns original text when no SUGG tags present", () => {
    const text = "Hello there.";
    expect(stripSuggestionTags(text)).toBe("Hello there.");
  });
});
