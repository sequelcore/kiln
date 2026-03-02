// Extracts AI-generated follow-up suggestions from LLM response text.
// The LLM appends suggestions in <<SUGG>>...<</SUGG>> format when instructed for web channels.

const SUGG_PATTERN = /<<SUGG>>(.*?)<<\/SUGG>>\s*$/s;

export interface ParsedResponse {
  readonly content: string;
  readonly suggestions: readonly string[];
}

export function extractSuggestions(text: string): ParsedResponse {
  const match = text.match(SUGG_PATTERN);
  if (!match) return { content: text, suggestions: [] };

  const suggestions = match[1]!.split("|").map((s) => s.trim()).filter(Boolean);
  const content = text.slice(0, match.index).trimEnd();
  return { content, suggestions };
}

/** Strips <<SUGG>> tags from text without parsing. Used for WhatsApp where suggestions aren't rendered. */
export function stripSuggestionTags(text: string): string {
  return text.replace(SUGG_PATTERN, "").trimEnd();
}
