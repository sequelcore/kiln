import type { ActionEffectEnvelope, DevTool, ToolInput, ToolResult } from "@kilnai/core";
import { applyConfigChange } from "./config-apply.js";

const CONFIG_APPLY_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

export class KilnConfigApplyChangeTool implements DevTool {
  readonly name = "kiln_config.apply_change";
  readonly description = [
    "Apply a previously approved canonical Kiln configuration-change proposal.",
    "Requires proposalId and approvalId produced by Kiln's governed config approval flow.",
    "Fails closed if the proposal is invalid, approval is missing, or canonical files changed after proposal creation.",
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
        description: "Approval id created by the operator approval flow for this proposal.",
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
      return {
        output: "kiln_config.apply_change requires proposalId and approvalId.",
        isError: true,
      };
    }

    let result: Awaited<ReturnType<typeof applyConfigChange>>;
    try {
      result = await applyConfigChange({
        projectPath: this.projectPath,
        proposalId,
        approvalId,
      });
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
    return {
      output: JSON.stringify(result, null, 2),
      isError: result.status !== "applied",
    };
  }
}

export function createKilnConfigApplyChangeTool(projectPath: string): KilnConfigApplyChangeTool {
  return new KilnConfigApplyChangeTool(projectPath);
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
