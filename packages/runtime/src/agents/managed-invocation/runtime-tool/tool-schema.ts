// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// The static ToolDefinition / Capability / ActionEffectEnvelope constants. No
// logic reading runtime state.
import {
  MANAGED_AGENT_ACCESS_LEVELS,
  WORK_CLASSIFICATION_ARTIFACTS,
  WORK_CLASSIFICATION_DOMAINS,
  WORK_CLASSIFICATION_EVIDENCE_SCOPES,
  WORK_CLASSIFICATION_EFFECTS,
  WORK_CLASSIFICATION_INTENTS,
  WORK_CLASSIFICATION_MODES,
} from "@kilnai/core";
import type {
  ActionEffectEnvelope,
  Capability,
  ToolDefinition,
} from "@kilnai/core";
import {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "../tool-names.js";

export const MANAGED_AGENT_ORCHESTRATION_ACCESS = MANAGED_AGENT_ACCESS_LEVELS;

export const MANAGED_AGENT_INVOKE_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_INVOKE_TOOL_NAME,
  description: "Request a governed managed child agent invocation through a configured Kiln runtime route. The runtime owns admission, authority, credentials, lifecycle evidence, and session events.",
  inputSchema: {
    type: "object",
    properties: {
      access: {
        type: "string",
        enum: ["read-only", "propose", "approved-write"],
        default: "read-only",
        description: "Managed invocation access level: read-only, propose, or approved-write.",
      },
      routeId: {
        type: "string",
        description: "Optional configured managed invocation route id.",
      },
      providerRoute: {
        type: "object",
        properties: {
          providerId: {
            type: "string",
            description: "Configured managed provider id.",
          },
          model: {
            type: "string",
            description: "Optional configured model selector. When supplied, it must match the selected managed route.",
          },
          deliberationIntent: {
            type: "object",
            description: "Optional provider-neutral deliberation intent resolved against the selected model before commitment.",
            properties: {
              mode: { type: "string", enum: ["provider-default", "fixed", "adaptive"] },
              target: { type: "string", enum: ["latency-first", "balanced", "quality-first"] },
              preferredLevel: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,63}$" },
              bounds: {
                type: "object",
                properties: {
                  min: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,63}$" },
                  max: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,63}$" },
                },
                additionalProperties: false,
              },
              onUnsupported: { type: "string", enum: ["deny", "omit", "allow-clamp"] },
            },
            required: ["mode", "onUnsupported"],
            additionalProperties: false,
          },
          communicationIntent: {
            type: "object",
            description: "Optional provider-neutral communication intent. Retry templates may carry a complete identity-verified resolution so source authority is unchanged.",
            properties: {
              version: { type: "string", enum: ["v1"] },
              intent: { type: "object" },
              authority: { type: "object" },
              identity: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
              responseDetail: { type: "string", enum: ["provider-default", "concise", "standard", "detailed"] },
              interactionProfile: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  revision: { type: "string" },
                  behaviors: {
                    type: "array",
                    items: { type: "string", enum: ["audience-calibrated", "findings-first", "next-action-explicit", "outcome-first", "plain-language", "state-visible"] },
                  },
                },
                required: ["id", "revision", "behaviors"],
                additionalProperties: false,
              },
              locale: { type: "string" },
              requiredContent: {
                type: "array",
                items: { type: "string", enum: ["approval-requirement", "citation", "decision", "failure", "finding", "next-action", "residual-risk", "verification", "warning"] },
              },
              artifactContract: {
                type: "object",
                properties: { id: { type: "string" }, revision: { type: "string" } },
                required: ["id", "revision"],
                additionalProperties: false,
              },
              responseSkills: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, revision: { type: "string" } },
                  required: ["id", "revision"],
                  additionalProperties: false,
                },
              },
              onUnsupported: { type: "string", enum: ["deny", "omit"] },
            },
            additionalProperties: false,
          },
        },
        required: ["providerId"],
        additionalProperties: false,
      },
      externalRuntimeAttachment: {
        type: "object",
        properties: {
          runtimeId: {
            type: "string",
            description: "Provider-neutral external runtime family identifier (the <server> segment of mcp:<server>:<kind>:<name>).",
          },
          attachmentId: {
            type: "string",
            description: "Opaque identity of one physical attached external-runtime instance.",
          },
        },
        required: ["runtimeId", "attachmentId"],
        additionalProperties: false,
        description: "Optional external-runtime instance this dispatch must target. When the selected route is attached to a specific external-runtime instance, this must match exactly or the dispatch is denied. Kiln never infers or defaults this value.",
      },
      requestedAuthority: {
        type: "string",
        enum: ["auto", "read_only", "audited", "destructive"],
        default: "auto",
        description: "Requested child authority. Use read_only for inspection-only children. Destructive authority is rejected until an explicit approval flow is available.",
      },
      task: {
        type: "string",
        description: "Bounded child task prompt.",
      },
      summary: {
        type: "string",
        description: "Optional short invocation summary. Defaults to task.",
      },
      resourceUris: {
        type: "array",
        items: { type: "string" },
        description: "Optional governed resource URIs to make available to the child. Required when contextMode is resources.",
      },
      agentProfile: {
        type: "string",
        description: "Optional configured Kiln agent profile to request for the child. The runtime must resolve and admit it before execution.",
      },
      forbiddenInputFields: {
        type: "array",
        items: { type: "string" },
        description: "Optional route-owned input contract from work_item.execution.start. Pass through unchanged; do not populate any listed fields.",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Optional configured Kiln skills to request for the child. Only request skills from the configured agent profile or an explicitly known Kiln skill catalog; do not invent skill names.",
      },
      workClassification: {
        type: "object",
        properties: {
          intents: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_INTENTS] },
            description: "Optional governed work intents, such as write, edit, review, support, code, or design.",
          },
          artifacts: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_ARTIFACTS] },
            description: "Optional artifact families the child will produce or review.",
          },
          domains: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_DOMAINS] },
            description: "Optional domain context for the child work.",
          },
          evidenceScopes: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_EVIDENCE_SCOPES] },
            description: "Optional evidence locations for research work: repository, external, or provided. Required to auto-recommend a research procedure.",
          },
          effects: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_EFFECTS] },
            description: "Optional authority/effect class for the child work.",
          },
          modes: {
            type: "array",
            items: { type: "string", enum: [...WORK_CLASSIFICATION_MODES] },
            description: "Optional interaction mode, such as answer, coauthor, transform, critique, delegate, automate, or monitor.",
          },
        },
        additionalProperties: false,
        description: "Optional explicit cross-domain work classification. It informs governed skill recommendation and diagnostics; it does not grant tool authority.",
      },
      contextMode: {
        type: "string",
        enum: ["isolated", "resources", "fork"],
        default: "isolated",
        description: "Child context mode. Use isolated by default. Use resources only when resourceUris is non-empty. fork requires explicit runtime support and policy admission.",
      },
      workItemId: {
        type: "string",
        description: "Optional governed work item id this child is executing or reviewing.",
      },
      goalRunId: {
        type: "string",
        description: "Optional governed goal run id this child is executing under.",
      },
      attemptId: {
        type: "string",
        description: "Optional governed work item execution attempt id for final-phase failure closeout.",
      },
      boundedWorkEffects: {
        type: "array",
        items: {
          type: "string",
          enum: ["inspect", "modify_source", "modify_tests", "modify_documentation", "modify_configuration", "run_verification", "invoke_managed_agent", "external_write"],
        },
        description: "Exact bounded-work effects requested by this governed child. Required for governed write-capable invocations and never grants authority by itself.",
      },
      roleIntent: {
        type: "string",
        description: "Optional short statement of why this child role/route was selected for the work item.",
      },
      expectedEvidence: {
        type: "array",
        items: { type: "string" },
        description: "Optional evidence the child is expected to produce or explicitly mark as unavailable.",
      },
      requiredToolNames: {
        type: "array",
        items: { type: "string" },
        description: "Optional exact tool names the selected route must allow before execution starts. The runtime fails closed when the route lacks any required tool.",
      },
      requiredReadPaths: {
        type: "array",
        items: { type: "string" },
        description: "Optional local paths the selected read-only route must be able to inspect before execution starts. The runtime fails closed when the route read authority does not cover every path.",
      },
      requiredResultFields: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "summary",
            "resourceUris",
            "evidence",
            "verificationResults",
            "uncertainty",
            "limitations",
            "warnings",
            "approvalRequirements",
            "residualRisks",
          ],
        },
        description: "Optional canonical child result fields required in a completed handoff.",
      },
      doneCriteria: {
        type: "array",
        items: { type: "string" },
        description: "Optional concrete done criteria for this child invocation.",
      },
      residualRiskRequired: {
        type: "boolean",
        description: "True when the child handoff must include explicit residual risk.",
      },
      outputVerbosity: {
        type: "string",
        enum: ["concise", "standard", "detailed"],
        description: "Visible handoff detail level, independent from provider reasoning effort. Control evidence is always preserved.",
      },
      executionPhase: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional governed execution phase id, such as visual-reference-research.",
          },
          expectedEvidence: {
            type: "array",
            items: { type: "string" },
            description: "Evidence this child phase must produce before the parent can advance.",
          },
          verificationRequirementIds: {
            type: "array",
            items: { type: "string" },
            description: "Exact requirement ids that must each have one structured verification result. Final phases include unaccounted closeout gates.",
          },
          requiredToolNames: {
            type: "array",
            items: { type: "string" },
            description: "Tool names required for this child phase.",
          },
          taskAffinity: {
            type: "array",
            items: { type: "string" },
            description: "Configured task-suitability dimensions used only after capability filtering to select a unique route.",
          },
          remainingEvidenceAfterPhase: {
            type: "array",
            items: { type: "string" },
            description: "Evidence still expected after this phase completes.",
          },
          completionTool: {
            type: "string",
            enum: ["work_item.update", "work_item.execution.finish"],
            description: "Governance tool that must record this phase result.",
          },
          finalPhase: {
            type: "boolean",
            description: "True when this child phase is the final execution phase.",
          },
          autoStartAllowed: {
            type: "boolean",
            description: "False when the parent must explicitly invoke the child before continuing.",
          },
          instruction: {
            type: "string",
            description: "Phase-specific instruction for recording evidence and follow-up.",
          },
        },
        additionalProperties: false,
        description: "Optional governed execution phase contract returned by work_item.execution.start. Pass it through unchanged when invoking the managed child.",
      },
    },
    required: ["access", "task"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-approval"]),
};

export const MANAGED_AGENT_START_TOOL: ToolDefinition = {
  ...MANAGED_AGENT_INVOKE_TOOL,
  name: MANAGED_AGENT_START_TOOL_NAME,
  description: "Start a governed managed child agent invocation in the background through a configured Kiln runtime route. Returns after admission with an invocation id; use managed_agent.status, managed_agent.list, and managed_agent.join to observe or wait.",
};

export const MANAGED_AGENT_STATUS_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_STATUS_TOOL_NAME,
  description: "Read the current lifecycle status for a managed child invocation in the current runtime session.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_LIST_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_LIST_TOOL_NAME,
  description: "List managed child invocations owned by the current runtime session.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_JOIN_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_JOIN_TOOL_NAME,
  description: "Wait for a managed child invocation in the current runtime session and publish its terminal lifecycle evidence exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-status"]),
};

export const MANAGED_AGENT_CANCEL_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_CANCEL_TOOL_NAME,
  description: "Cancel a running managed child invocation in the current runtime session, signal the child adapter, and publish terminal cancellation evidence exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      invocationId: {
        type: "string",
        description: "Managed child invocation id returned by managed_agent.start.",
      },
      reason: {
        type: "string",
        description: "Operator-facing reason for cancellation.",
      },
    },
    required: ["invocationId"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-control"]),
};

export const MANAGED_AGENT_ORCHESTRATE_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  description: "Select and execute a governed managed-agent coordination topology from an explicit work graph. Runtime capacity bounds concurrency; the caller does not choose a provider ranking or worker count.",
  inputSchema: {
    type: "object",
    properties: {
      access: { type: "string", enum: MANAGED_AGENT_ORCHESTRATION_ACCESS },
      taskRisk: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      requiresIndependentReview: { type: "boolean" },
      workItems: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            roleIntent: { type: "string", minLength: 1 },
            task: { type: "string", minLength: 1 },
            agentProfile: { type: "string", minLength: 1 },
            routeId: { type: "string", minLength: 1 },
            dependencies: { type: "array", items: { type: "string", minLength: 1 } },
          },
          required: ["id", "roleIntent", "task"],
          additionalProperties: false,
        },
      },
    },
    required: ["access", "taskRisk", "requiresIndependentReview", "workItems"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "orchestration", "operator-approval"]),
};

const MANAGED_AGENT_DESTRUCTIVE_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "network"],
  reversibility: "irreversible",
  dataEgress: "sensitive-data",
  identityUse: "authenticated",
  consequences: ["local-state", "external-state"],
  idempotency: "non-idempotent",
};

const MANAGED_AGENT_OBSERVE_ENVELOPE: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const MANAGED_AGENT_CONTROL_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "conditionally-idempotent",
};

export const MANAGED_AGENT_INVOKE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_INVOKE_TOOL.name,
  description: MANAGED_AGENT_INVOKE_TOOL.description,
  schema: MANAGED_AGENT_INVOKE_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};

export const MANAGED_AGENT_START_CAPABILITY: Capability = {
  name: MANAGED_AGENT_START_TOOL.name,
  description: MANAGED_AGENT_START_TOOL.description,
  schema: MANAGED_AGENT_START_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};

export const MANAGED_AGENT_STATUS_CAPABILITY: Capability = {
  name: MANAGED_AGENT_STATUS_TOOL.name,
  description: MANAGED_AGENT_STATUS_TOOL.description,
  schema: MANAGED_AGENT_STATUS_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_LIST_CAPABILITY: Capability = {
  name: MANAGED_AGENT_LIST_TOOL.name,
  description: MANAGED_AGENT_LIST_TOOL.description,
  schema: MANAGED_AGENT_LIST_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_JOIN_CAPABILITY: Capability = {
  name: MANAGED_AGENT_JOIN_TOOL.name,
  description: MANAGED_AGENT_JOIN_TOOL.description,
  schema: MANAGED_AGENT_JOIN_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-status"],
  effectEnvelope: MANAGED_AGENT_OBSERVE_ENVELOPE,
};

export const MANAGED_AGENT_CANCEL_CAPABILITY: Capability = {
  name: MANAGED_AGENT_CANCEL_TOOL.name,
  description: MANAGED_AGENT_CANCEL_TOOL.description,
  schema: MANAGED_AGENT_CANCEL_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-control"],
  effectEnvelope: MANAGED_AGENT_CONTROL_ENVELOPE,
};

export const MANAGED_AGENT_ORCHESTRATE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_ORCHESTRATE_TOOL.name,
  description: MANAGED_AGENT_ORCHESTRATE_TOOL.description,
  schema: MANAGED_AGENT_ORCHESTRATE_TOOL.inputSchema,
  tags: ["managed-invocation", "orchestration", "operator-approval"],
  effectEnvelope: MANAGED_AGENT_DESTRUCTIVE_ENVELOPE,
};
