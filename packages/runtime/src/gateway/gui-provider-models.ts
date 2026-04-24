import { MODEL_CATALOG } from "@kilnai/core";

const DEFAULT_CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"];
const DEFAULT_CODEX_MODELS = ["o4-mini", "o3", "o3-mini"];
const CODEX_OAUTH_PREFERRED_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark"];
const DEFAULT_CODEX_OAUTH_MODELS = orderPreferredModels(
  [
    ...MODEL_CATALOG
      .filter((entry) => entry.provider === "codex-oauth")
      .map((entry) => entry.model),
    ...CODEX_OAUTH_PREFERRED_MODELS,
  ],
  CODEX_OAUTH_PREFERRED_MODELS,
);

const OPENCODE_GO_MODELS = orderPreferredModels(
  [
    ...MODEL_CATALOG
      .filter((entry) => entry.provider === "opencode-go")
      .map((entry) => entry.model),
  ],
  [],
);

const OPENCODE_ZEN_MODELS = orderPreferredModels(
  [
    ...MODEL_CATALOG
      .filter((entry) => entry.provider === "opencode-zen")
      .map((entry) => entry.model),
  ],
  [],
);

export function buildGuiOperatorModels(input: {
  readonly opencodeModels: readonly string[];
  readonly codexModels: readonly string[];
  readonly opencodeTier: "go" | "zen" | null;
}): Record<string, string[]> {
  const result: Record<string, string[]> = {
    claude: [...DEFAULT_CLAUDE_MODELS],
    codex: input.codexModels.length > 0 ? [...input.codexModels] : [...DEFAULT_CODEX_MODELS],
    opencode: [...input.opencodeModels],
    "codex-oauth": [...DEFAULT_CODEX_OAUTH_MODELS],
  };

  if (input.opencodeTier === "go") {
    result["opencode-go"] = [...OPENCODE_GO_MODELS];
  } else if (input.opencodeTier === "zen") {
    result["opencode-zen"] = [...OPENCODE_ZEN_MODELS];
  }

  return result;
}

function orderPreferredModels(
  models: readonly string[],
  preferredOrder: readonly string[],
): string[] {
  const uniqueModels = [...new Set(models)];
  const preferred = preferredOrder.filter((model) => uniqueModels.includes(model));
  const remainder = uniqueModels.filter((model) => !preferred.includes(model));
  return [...preferred, ...remainder];
}
