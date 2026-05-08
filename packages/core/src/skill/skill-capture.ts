import type { AgentMessage, ProviderAdapter } from "../agents/index.js";
import { extractText, textParts } from "../engine/domain/content.js";

const MAX_NAME_LENGTH = 40;

const SUMMARY_SYSTEM_PROMPT = `You extract reusable skill knowledge from completed AI sessions.
Return ONLY valid JSON with exactly these keys:
- title: string
- goal: string
- reusableWhen: string
- tools: string[]
- steps: string[]
- pitfalls: string[]
- tags: string[]

Keep the output concise, concrete, and reusable.`;

const SKILL_SYSTEM_PROMPT = `You write reusable SKILL.md files.
Output ONLY the SKILL.md content.
Requirements:
- Start with YAML frontmatter delimited by ---
- Include frontmatter keys: name, description, tools, tags
- name must be kebab-case and no more than 40 characters
- description must be one sentence
- Then write a markdown body with clear reusable instructions`;

export type SessionEvent =
  | { readonly type: "text_delta"; readonly content: string }
  | { readonly type: "tool_use"; readonly toolName: string; readonly input?: unknown }
  | { readonly type: "tool_result" };

export interface PersistedTranscriptEvent {
  readonly seq: number;
  readonly ts: string;
  readonly event: SessionEvent;
}

export interface SkillCaptureSummary {
  readonly title: string;
  readonly goal: string;
  readonly reusableWhen: string;
  readonly tools: string[];
  readonly steps: string[];
  readonly pitfalls: string[];
  readonly tags: string[];
}

export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export interface SkillCaptureInput {
  readonly task: string;
  readonly transcript: readonly PersistedTranscriptEvent[];
  readonly toolCount: number;
  readonly turnDepth: number;
}

export interface SkillCaptureServiceConfig {
  readonly provider: ProviderAdapter;
  readonly complexityThreshold?: number;
}

export class SkillCaptureService {
  private readonly provider: ProviderAdapter;

  constructor(config: SkillCaptureServiceConfig) {
    this.provider = config.provider;
  }

  async extractSummary(input: SkillCaptureInput): Promise<SkillCaptureSummary | null> {
    const transcriptText = input.transcript
      .filter((entry): entry is PersistedTranscriptEvent & { event: { type: "text_delta"; content: string } } =>
        entry.event.type === "text_delta"
      )
      .map((entry) => entry.event.content)
      .join("");

    const messages: readonly AgentMessage[] = [
      {
        role: "user",
        parts: textParts(
          [
            `Task: ${input.task}`,
            `Tool count: ${input.toolCount}`,
            `Turn depth: ${input.turnDepth}`,
            "Conversation text:",
            transcriptText,
          ].join("\n\n"),
        ),
      },
    ];

    try {
      const response = await this.provider.createMessage({
        system: SUMMARY_SYSTEM_PROMPT,
        messages,
        maxTokens: 1024,
      });
      const raw = extractText(response.parts);
      const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
      return normalizeSummary(parsed);
    } catch {
      return null;
    }
  }

  async generateSkill(summary: SkillCaptureSummary): Promise<SkillDraft | null> {
    const messages: readonly AgentMessage[] = [
      {
        role: "user",
        parts: textParts(JSON.stringify(summary, null, 2)),
      },
    ];

    try {
      const response = await this.provider.createMessage({
        system: SKILL_SYSTEM_PROMPT,
        messages,
        maxTokens: 2048,
      });
      const rawContent = extractText(response.parts).trim();
      if (!rawContent.startsWith("---")) {
        return null;
      }

      const nameMatch = /^name:\s*(.+)$/m.exec(rawContent);
      const descriptionMatch = /^description:\s*(.+)$/m.exec(rawContent);
      if (!nameMatch || !descriptionMatch) {
        return null;
      }

      const name = sanitizeName(nameMatch[1]!);
      if (!name) {
        return null;
      }

      const content = rawContent.replace(/^name:\s*.+$/m, `name: ${name}`);
      return {
        name,
        description: descriptionMatch[1]!.trim(),
        content,
      };
    } catch {
      return null;
    }
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function normalizeSummary(parsed: Record<string, unknown>): SkillCaptureSummary | null {
  const title = asNonEmptyString(parsed.title);
  const goal = asNonEmptyString(parsed.goal);
  const reusableWhen = asNonEmptyString(parsed.reusableWhen);
  const tools = asStringArray(parsed.tools);
  const steps = asStringArray(parsed.steps);
  const pitfalls = asStringArray(parsed.pitfalls);
  const tags = asStringArray(parsed.tags);

  if (!title || !goal || !reusableWhen || !tools || !steps || !pitfalls || !tags) {
    return null;
  }

  return {
    title,
    goal,
    reusableWhen,
    tools,
    steps,
    pitfalls,
    tags,
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length === value.length ? items : null;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^-+|-+$/g, "");
}
