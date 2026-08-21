import type { ActionEffectEnvelope, DevTool, ToolInput, ToolResult } from "@kilnai/core";
import { applyConfigMutation } from "./config-mutation-authority.js";

const CONFIG_APPLY_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  // Settlement is keyed by proposal identity, so a retried apply replays the
  // committed result instead of writing twice.
  idempotency: "idempotent",
};

export class KilnConfigApplyChangeTool implements DevTool {
  readonly name = "kiln_config.apply_change";
  readonly description = [
    "Apply a canonical Kiln configuration-change proposal.",
    "Always requires an operator approvalId; a model may never commit configuration on its own authority.",
    "Fails closed if the proposal is invalid, the base revision changed, or an approval does not match.",
    "Reports committed, committed-reconciliation-failed, or rejected honestly.",
  ].join(" ");
  readonly effectEnvelope = CONFIG_APPLY_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      proposalId: {
        type: "string",
        minLength: 1,
        description: "Config proposal id returned by kiln_config.propose_change.",
      },
      approvalId: {
        type: "string",
        minLength: 1,
        description: "Approval id created by the operator for this exact proposal. Always required for model-called applies.",
      },
    },
    required: ["proposalId", "approvalId"],
    additionalProperties: false,
  };

  constructor(private readonly projectPath: string) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const proposalId = parseString(input.input.proposalId);
    const approvalId = parseString(input.input.approvalId);
    if (!proposalId || !approvalId) {
      return { output: "kiln_config.apply_change requires proposalId and approvalId.", isError: true };
    }

    let result: Awaited<ReturnType<typeof applyConfigMutation>>;
    try {
      result = await applyConfigMutation({
        projectPath: this.projectPath,
        proposalId,
        approvalId,
        requester: "model",
      });
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
    return {
      output: JSON.stringify(result, null, 2),
      isError: result.settlement.outcome === "rejected",
    };
  }
}

export function createKilnConfigApplyChangeTool(projectPath: string): KilnConfigApplyChangeTool {
  return new KilnConfigApplyChangeTool(projectPath);
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
