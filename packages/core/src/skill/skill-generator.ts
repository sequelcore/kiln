import { mkdir, writeFile } from "node:fs/promises";
import type { ProviderAdapter } from "../agents/index.js";
import type { AgentMessage } from "../agents/index.js";
import { textParts, extractText } from "../engine/domain/content.js";
import { scoreComplexity } from "../agents/complexity-scorer.js";
import { parseSkillMd } from "./md-parser.js";
import type { SkillRegistry } from "./skill-registry.js";
import { SkillCaptureService } from "./skill-capture.js";
import type { PersistedTranscriptEvent } from "./skill-capture.js";

const DEFAULT_THRESHOLD = 0.6;
const MAX_NAME_LENGTH = 40;

const SYSTEM_PROMPT = `You are a skill extractor. Given a completed AI task and its output, generate a reusable SKILL.md file that captures the key technique or procedure demonstrated.
Format: YAML frontmatter (---) with name (kebab-case, max 40 chars), description (one sentence), tools (array of tool names used), tags (array). Then a markdown body with clear step-by-step instructions. Be concise. Output ONLY the SKILL.md content, nothing else.`;

export interface SkillGeneratorConfig {
  readonly provider: ProviderAdapter;
  readonly registry: SkillRegistry;
  readonly skillsDir: string;
  readonly complexityThreshold?: number;
}

export class SkillGenerator {
  private readonly provider: ProviderAdapter;
  private readonly registry: SkillRegistry;
  private readonly skillsDir: string;
  private readonly threshold: number;
  private readonly captureService: SkillCaptureService;

  constructor(config: SkillGeneratorConfig) {
    this.provider = config.provider;
    this.registry = config.registry;
    this.skillsDir = config.skillsDir;
    this.threshold = config.complexityThreshold ?? DEFAULT_THRESHOLD;
    this.captureService = new SkillCaptureService({
      provider: config.provider,
      complexityThreshold: config.complexityThreshold,
    });
  }

  async maybeGenerate(
    task: string,
    sessionOutput: string,
    toolCount: number,
    turnDepth: number,
    transcript?: readonly PersistedTranscriptEvent[],
  ): Promise<boolean> {
    const complexity = scoreComplexity({ messageText: task, toolCount, turnDepth });
    if (complexity.score < this.threshold) {
      return false;
    }

    if (transcript && transcript.length > 0) {
      const summary = await this.captureService.extractSummary({
        task,
        transcript,
        toolCount,
        turnDepth,
      });
      if (!summary) {
        return false;
      }

      const draft = await this.captureService.generateSkill(summary);
      if (!draft) {
        return false;
      }

      return this.writeAndRegister(draft.name, draft.content);
    }

    const messages: readonly AgentMessage[] = [
      {
        role: "user",
        parts: textParts(
          `Task: ${task}\n\nOutput summary:\n${sessionOutput.slice(0, 2000)}`,
        ),
      },
    ];

    let rawContent: string;
    try {
      const response = await this.provider.createMessage({
        system: SYSTEM_PROMPT,
        messages,
        maxTokens: 1024,
      });
      rawContent = extractText(response.parts);
    } catch {
      return false;
    }

    if (!rawContent.trim().startsWith("---")) {
      return false;
    }

    const nameMatch = /^name:\s*(.+)$/m.exec(rawContent);
    if (!nameMatch) {
      return false;
    }

    const sanitized = sanitizeName(nameMatch[1]!);
    if (!sanitized) {
      return false;
    }

    return this.writeAndRegister(sanitized, rawContent);
  }

  private async writeAndRegister(skillName: string, rawContent: string): Promise<boolean> {
    const skillPath = `${this.skillsDir}/${skillName}/SKILL.md`;
    try {
      await mkdir(`${this.skillsDir}/${skillName}`, { recursive: true });
      await writeFile(skillPath, rawContent, "utf-8");
    } catch {
      return false;
    }

    try {
      const skillConfig = parseSkillMd(rawContent, skillPath);
      this.registry.registerFull(skillConfig);
    } catch {
      return false;
    }

    return true;
  }
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
