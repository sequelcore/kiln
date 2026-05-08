import type { DevTool, ToolInput, ToolResult } from "@kilnai/core";
import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";
import { assessWorkGovernance } from "./work-governance-policy.js";

const TRIGGERS: readonly KilnWorkGovernanceTrigger[] = [
  "architecture",
  "security",
  "ui",
  "runtime",
  "provider-routing",
  "managed-agents",
  "config",
  "multi-file",
  "cross-surface",
  "long-running",
  "verification-heavy",
  "formal-proof-candidate",
];

const RISKS: readonly KilnWorkGovernanceRisk[] = ["low", "medium", "high"];

export function createWorkGovernanceTools(config: KilnWorkGovernanceConfig | undefined): readonly DevTool[] {
  return [new WorkGovernanceAssessTool(config)];
}

export class WorkGovernanceAssessTool implements DevTool {
  readonly name = "work_governance.assess";

  readonly description = [
    "Assess whether a task should be handled directly or orchestrated through managed agents.",
    "Use before broad, risky, cross-surface, provider, runtime, UI, config, or verification-heavy work.",
  ].join(" ");

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        minLength: 1,
        description: "Short description of the intended work.",
      },
      estimatedFiles: {
        type: "number",
        minimum: 0,
        description: "Optional estimated number of files the work may touch.",
      },
      risk: {
        enum: RISKS,
        description: "Optional preliminary risk estimate.",
      },
      triggers: {
        type: "array",
        items: { enum: TRIGGERS },
        description: "Known work-governance triggers that apply to this task.",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  };

  readonly outputSchema = {
    type: "object",
    properties: {
      recommendation: { enum: ["direct", "orchestrate"] },
      reasons: { type: "array", items: { type: "string" } },
      triggers: { type: "array", items: { enum: TRIGGERS } },
      requiredEvidence: { type: "array", items: { type: "string" } },
    },
    required: ["recommendation", "reasons", "triggers", "requiredEvidence"],
    additionalProperties: false,
  };

  constructor(private readonly config: KilnWorkGovernanceConfig | undefined) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const summary = input.input.summary;
    if (typeof summary !== "string" || summary.trim().length === 0) {
      return { output: 'Invalid input: "summary" must be a non-empty string', isError: true };
    }

    const estimatedFiles = typeof input.input.estimatedFiles === "number" && Number.isFinite(input.input.estimatedFiles)
      ? input.input.estimatedFiles
      : undefined;
    const risk = isRisk(input.input.risk) ? input.input.risk : undefined;
    const triggers = Array.isArray(input.input.triggers)
      ? input.input.triggers.filter(isTrigger)
      : [];

    const assessment = assessWorkGovernance(this.config, {
      summary,
      estimatedFiles,
      risk,
      triggers,
    });

    return {
      output: [
        `recommendation: ${assessment.recommendation}`,
        `reasons: ${assessment.reasons.join("; ")}`,
        assessment.triggers.length > 0 ? `triggers: ${assessment.triggers.join(", ")}` : "triggers: none",
        assessment.requiredEvidence.length > 0
          ? `requiredEvidence: ${assessment.requiredEvidence.join(", ")}`
          : "requiredEvidence: none",
      ].join("\n"),
      isError: false,
    };
  }
}

function isRisk(value: unknown): value is KilnWorkGovernanceRisk {
  return RISKS.includes(value as KilnWorkGovernanceRisk);
}

function isTrigger(value: unknown): value is KilnWorkGovernanceTrigger {
  return TRIGGERS.includes(value as KilnWorkGovernanceTrigger);
}
