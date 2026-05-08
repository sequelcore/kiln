import type { DevTool, ToolInput, ToolResult, WorkItemStatus } from "@kilnai/core";
import { WorkItemStore, workItemToolMetadata } from "@kilnai/core";
import type {
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceEvidence,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
} from "../kiln-yaml-types.js";
import { assessWorkGovernance } from "./work-governance-policy.js";
import {
  chooseWorkflowProfile,
  findWorkflowProfile,
  WORK_GOVERNANCE_WORKFLOW_PROFILES,
} from "./work-governance-workflows.js";

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

const EVIDENCE: readonly KilnWorkGovernanceEvidence[] = [
  "surface-map",
  "risk-hypothesis",
  "spec",
  "plan",
  "tests",
  "typecheck",
  "browser-qa",
  "managed-agent-review",
  "formal-proof",
  "residual-risk",
];

const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["pending", "in_progress", "blocked", "completed", "cancelled"];

export function createWorkGovernanceTools(
  config: KilnWorkGovernanceConfig | undefined,
  options: { readonly workItemStore?: WorkItemStore } = {},
): readonly DevTool[] {
  const store = options.workItemStore ?? new WorkItemStore();
  return [
    new WorkGovernanceAssessTool(config),
    new WorkProfileListTool(),
    new WorkItemUpdateTool(config, store),
    new WorkItemListTool(store),
    new WorkItemCompleteTool(store),
  ];
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

export class WorkProfileListTool implements DevTool {
  readonly name = "work_profile.list";

  readonly description = [
    "List canonical Kiln workflow profiles for selecting the right execution posture, agents, authority, and evidence gates.",
    "Use before creating governed work items or delegating broad work.",
  ].join(" ");

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      trigger: {
        enum: TRIGGERS,
        description: "Optional trigger filter.",
      },
    },
    additionalProperties: false,
  };

  async execute(input: ToolInput): Promise<ToolResult> {
    const trigger = isTrigger(input.input.trigger) ? input.input.trigger : undefined;
    const profiles = trigger
      ? WORK_GOVERNANCE_WORKFLOW_PROFILES.filter((profile) => profile.triggers.includes(trigger))
      : WORK_GOVERNANCE_WORKFLOW_PROFILES;

    return {
      output: JSON.stringify({
        profiles: profiles.map((profile) => ({
          id: profile.id,
          description: profile.description,
          triggers: profile.triggers,
          minimumRisk: profile.minimumRisk,
          recommendedAgentProfiles: profile.recommendedAgentProfiles,
          defaultAuthorityProfile: profile.defaultAuthorityProfile,
          requiredEvidence: profile.requiredEvidence,
          verificationGates: profile.verificationGates,
        })),
      }, null, 2),
      isError: false,
    };
  }
}

export class WorkItemUpdateTool implements DevTool {
  readonly name = "work_item.update";

  readonly description = [
    "Create or update a governed work item with workflow profile, expected evidence, route/agent hints, and verification gates.",
    "Use this when decomposing non-trivial work before managed child invocation or direct execution.",
  ].join(" ");

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional stable work item id. Omit to create a new id." },
      summary: { type: "string", minLength: 1, description: "Bounded work item summary." },
      status: { enum: WORK_ITEM_STATUSES, description: "Optional lifecycle status." },
      workflowProfile: {
        enum: WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => profile.id),
        description: "Optional workflow profile. When omitted, Kiln infers one from triggers and risk.",
      },
      risk: { enum: RISKS, description: "Optional risk estimate." },
      triggers: {
        type: "array",
        items: { enum: TRIGGERS },
        description: "Governance triggers that apply to this work item.",
      },
      surface: { type: "string", description: "Optional affected surface, such as gui, cli, tui, runtime, or docs." },
      assignedAgentProfile: { type: "string", description: "Optional configured Kiln agent profile assigned to the work item." },
      routeId: { type: "string", description: "Optional managed invocation route id." },
      authorityProfile: { type: "string", description: "Optional authority profile for the assigned work." },
      expectedEvidence: {
        type: "array",
        items: { enum: EVIDENCE },
        description: "Optional extra or overriding evidence expected before closeout.",
      },
      providedEvidence: {
        type: "array",
        items: { enum: EVIDENCE },
        description: "Optional evidence already produced.",
      },
      verificationGates: {
        type: "array",
        items: { type: "string" },
        description: "Optional extra verification gates.",
      },
      dependencies: {
        type: "array",
        items: { type: "string" },
        description: "Optional work item ids that must complete first.",
      },
      residualRisk: { type: "string", description: "Known residual risk, if already available." },
    },
    required: ["summary"],
    additionalProperties: false,
  };

  constructor(
    private readonly config: KilnWorkGovernanceConfig | undefined,
    private readonly store: WorkItemStore,
  ) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const summary = readText(input.input.summary);
    if (!summary) {
      return { output: 'Invalid input: "summary" must be a non-empty string', isError: true };
    }

    const triggers = readTriggers(input.input.triggers);
    const risk = isRisk(input.input.risk) ? input.input.risk : undefined;
    const explicitProfile = readText(input.input.workflowProfile);
    const workflowProfile = explicitProfile ? findWorkflowProfile(explicitProfile) : chooseWorkflowProfile(triggers, risk);
    if (!workflowProfile) {
      return { output: `Invalid input: unknown workflowProfile "${explicitProfile}"`, isError: true };
    }

    const assessment = assessWorkGovernance(this.config, {
      summary,
      risk,
      triggers,
    });
    const expectedEvidence = uniqueEvidence([
      ...workflowProfile.requiredEvidence,
      ...assessment.requiredEvidence,
      ...readEvidence(input.input.expectedEvidence),
    ]);
    const verificationGates = uniqueText([
      ...workflowProfile.verificationGates,
      ...readTextArray(input.input.verificationGates),
    ]);

    const item = this.store.upsert({
      id: readText(input.input.id),
      summary,
      status: readStatus(input.input.status),
      workflowProfile: workflowProfile.id,
      risk,
      triggers,
      surface: readText(input.input.surface),
      assignedAgentProfile: readText(input.input.assignedAgentProfile),
      routeId: readText(input.input.routeId),
      authorityProfile: readText(input.input.authorityProfile) ?? workflowProfile.defaultAuthorityProfile,
      expectedEvidence,
      providedEvidence: readEvidence(input.input.providedEvidence),
      verificationGates,
      dependencies: readTextArray(input.input.dependencies),
      residualRisk: readText(input.input.residualRisk),
    });

    return {
      output: JSON.stringify({ item }, null, 2),
      metadata: workItemToolMetadata("work_item.update", {
        operation: "update",
        id: item.id,
        status: item.status,
        item,
        sequence: item.sequence,
      }),
      isError: false,
    };
  }
}

export class WorkItemListTool implements DevTool {
  readonly name = "work_item.list";

  readonly description = "List session governed work items and their evidence status.";

  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      status: { enum: WORK_ITEM_STATUSES, description: "Optional status filter." },
    },
    additionalProperties: false,
  };

  constructor(private readonly store: WorkItemStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const status = readStatus(input.input.status);
    const items = this.store.list(status);
    const snapshot = this.store.snapshot(status);
    return {
      output: JSON.stringify({ items }, null, 2),
      metadata: workItemToolMetadata("work_item.list", {
        operation: "list",
        ...(status ? { status } : {}),
        items,
        itemCount: items.length,
        sequence: snapshot.sequence,
      }),
      isError: false,
    };
  }
}

export class WorkItemCompleteTool implements DevTool {
  readonly name = "work_item.complete";

  readonly description = [
    "Attempt to close a governed work item.",
    "The tool fails closed when expected evidence or required residual risk is missing.",
  ].join(" ");

  readonly annotations = {
    readOnly: false,
    idempotent: false,
  };

  readonly inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Work item id." },
      providedEvidence: {
        type: "array",
        items: { enum: EVIDENCE },
        description: "Evidence produced for this work item.",
      },
      residualRisk: { type: "string", description: "Residual-risk closeout. Required when residual-risk is expected evidence." },
    },
    required: ["id"],
    additionalProperties: false,
  };

  constructor(private readonly store: WorkItemStore) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const id = readText(input.input.id);
    if (!id) {
      return { output: 'Invalid input: "id" must be a non-empty string', isError: true };
    }

    const completion = this.store.complete({
      id,
      providedEvidence: readEvidence(input.input.providedEvidence),
      residualRisk: readText(input.input.residualRisk),
    });
    if (!completion) {
      return { output: `Work item not found: ${id}`, isError: true };
    }

    const missing = [
      ...completion.missingEvidence,
      ...(completion.missingResidualRisk ? ["residual-risk closeout"] : []),
    ];
    if (missing.length > 0) {
      return {
        output: JSON.stringify({
          status: "blocked",
          missing,
          item: completion.item,
        }, null, 2),
        metadata: workItemToolMetadata("work_item.complete", {
          operation: "complete",
          id: completion.item.id,
          status: completion.item.status,
          item: completion.item,
          missingEvidence: completion.missingEvidence,
          missingResidualRisk: completion.missingResidualRisk,
          sequence: completion.item.sequence,
          errorCode: "missing_evidence",
        }),
        isError: true,
      };
    }

    return {
      output: JSON.stringify({
        status: "completed",
        item: completion.item,
      }, null, 2),
      metadata: workItemToolMetadata("work_item.complete", {
        operation: "complete",
        id: completion.item.id,
        status: completion.item.status,
        item: completion.item,
        missingEvidence: completion.missingEvidence,
        missingResidualRisk: completion.missingResidualRisk,
        sequence: completion.item.sequence,
      }),
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

function readStatus(value: unknown): WorkItemStatus | undefined {
  return WORK_ITEM_STATUSES.includes(value as WorkItemStatus) ? value as WorkItemStatus : undefined;
}

function readTriggers(value: unknown): readonly KilnWorkGovernanceTrigger[] {
  return Array.isArray(value) ? uniqueText(value.filter(isTrigger)) as readonly KilnWorkGovernanceTrigger[] : [];
}

function readEvidence(value: unknown): readonly KilnWorkGovernanceEvidence[] {
  return Array.isArray(value) ? uniqueEvidence(value.filter(isEvidence)) : [];
}

function isEvidence(value: unknown): value is KilnWorkGovernanceEvidence {
  return EVIDENCE.includes(value as KilnWorkGovernanceEvidence);
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? uniqueText(value.map(readText).filter((item): item is string => item !== undefined))
    : [];
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueEvidence(values: readonly KilnWorkGovernanceEvidence[]): readonly KilnWorkGovernanceEvidence[] {
  return [...new Set(values)];
}

function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
