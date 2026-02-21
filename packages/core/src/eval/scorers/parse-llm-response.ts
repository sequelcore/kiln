// parseLLMResponse: extracts SCORE and REASONING from LLM evaluation output

export function parseLLMResponse(
  response: string,
  scorerName: string,
): { readonly score: number; readonly reasoning: string } {
  const scoreMatch = response.match(/SCORE:\s*([\d.]+)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+)/is);

  if (!scoreMatch) {
    return { score: 0, reasoning: `failed to parse LLM response for ${scorerName}` };
  }

  const rawScore = parseFloat(scoreMatch[1]!);
  const score = Number.isNaN(rawScore) ? 0 : Math.max(0, Math.min(1, rawScore));
  const reasoning = reasoningMatch?.[1]?.trim() ?? "";
  return { score, reasoning };
}
