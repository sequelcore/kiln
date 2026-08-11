import anthropicMarkUrl from "@lobehub/icons-static-svg/icons/anthropic.svg?url";
import claudeMarkUrl from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import codexMarkUrl from "@lobehub/icons-static-svg/icons/codex.svg?url";
import deepSeekMarkUrl from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import lmStudioMarkUrl from "@lobehub/icons-static-svg/icons/lmstudio.svg?url";
import ollamaMarkUrl from "@lobehub/icons-static-svg/icons/ollama.svg?url";
import openAiMarkUrl from "@lobehub/icons-static-svg/icons/openai.svg?url";
import openCodeMarkUrl from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import openRouterMarkUrl from "@lobehub/icons-static-svg/icons/openrouter-color.svg?url";
import { CloudIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface ProviderBrandMark {
  readonly brand: string;
  readonly source: string;
  readonly treatment: "color" | "monochrome";
}

const PROVIDER_BRAND_MARKS: Readonly<Record<string, ProviderBrandMark>> = {
  anthropic: { brand: "anthropic", source: anthropicMarkUrl, treatment: "monochrome" },
  claude: { brand: "claude", source: claudeMarkUrl, treatment: "color" },
  codex: { brand: "codex", source: codexMarkUrl, treatment: "monochrome" },
  "codex-oauth": { brand: "codex", source: codexMarkUrl, treatment: "monochrome" },
  deepseek: { brand: "deepseek", source: deepSeekMarkUrl, treatment: "color" },
  lmstudio: { brand: "lmstudio", source: lmStudioMarkUrl, treatment: "monochrome" },
  ollama: { brand: "ollama", source: ollamaMarkUrl, treatment: "monochrome" },
  openai: { brand: "openai", source: openAiMarkUrl, treatment: "monochrome" },
  opencode: { brand: "opencode", source: openCodeMarkUrl, treatment: "monochrome" },
  "opencode-go": { brand: "opencode", source: openCodeMarkUrl, treatment: "monochrome" },
  "opencode-zen": { brand: "opencode", source: openCodeMarkUrl, treatment: "monochrome" },
  openrouter: { brand: "openrouter", source: openRouterMarkUrl, treatment: "color" },
};

interface ProviderGlyphProps {
  readonly providerId: string;
  readonly className?: string;
}

/** GUI-owned provider recognition. Routing authority remains in gateway contracts. */
export function ProviderGlyph({ className, providerId }: ProviderGlyphProps) {
  const mark = PROVIDER_BRAND_MARKS[providerId];
  if (!mark) {
    return (
      <CloudIcon
        data-icon="inline-start"
        data-provider-fallback="true"
        className={cn("size-4 shrink-0 text-muted-foreground", className)}
        aria-hidden="true"
      />
    );
  }

  if (mark.treatment === "color") {
    return (
      <img
        src={mark.source}
        alt=""
        data-icon="inline-start"
        data-provider-brand={mark.brand}
        className={cn("size-4 shrink-0 object-contain", className)}
        aria-hidden="true"
      />
    );
  }

  const maskStyle: CSSProperties = {
    maskImage: `url("${mark.source}")`,
    maskPosition: "center",
    maskRepeat: "no-repeat",
    maskSize: "contain",
  };
  return (
    <span
      data-icon="inline-start"
      data-provider-brand={mark.brand}
      className={cn("inline-block size-4 shrink-0 bg-current text-foreground", className)}
      style={maskStyle}
      aria-hidden="true"
    />
  );
}
