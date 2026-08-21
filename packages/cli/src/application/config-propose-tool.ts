import type { ActionEffectEnvelope, DevTool, ToolInput, ToolResult } from "@kilnai/core";
import { KILN_CONFIG_MUTATION_OPERATIONS } from "@kilnai/gateway-contracts";
import type { KilnConfigMutationOperation } from "@kilnai/gateway-contracts";
import { ConfigMutationStore } from "./config-mutation-store.js";
import { proposeConfigMutation } from "./config-mutation-authority.js";

const CONFIG_PROPOSAL_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

export class KilnConfigProposeChangeTool implements DevTool {
  readonly name = "kiln_config.propose_change";
  readonly description = [
    "Create a validated canonical Kiln configuration-change proposal without writing files.",
    "Returns the base revision, authority impact, whether approval is required, activation behavior, and a preview.",
    "Use it before any apply step; the same intent against the same base revision always returns the same proposalId.",
  ].join(" ");
  readonly effectEnvelope = CONFIG_PROPOSAL_EFFECT;
  readonly inputSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: KILN_CONFIG_MUTATION_OPERATIONS,
        description: "Bounded config operation to propose.",
      },
      payload: {
        type: "object",
        description: "Operation-specific desired intent.",
        additionalProperties: true,
      },
    },
    required: ["operation", "payload"],
    additionalProperties: false,
  };

  constructor(private readonly projectPath: string) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const operation = parseOperation(input.input.operation);
    if (!operation) {
      return {
        output: `Invalid kiln_config.propose_change operation. Valid operations: ${KILN_CONFIG_MUTATION_OPERATIONS.join(", ")}`,
        isError: true,
      };
    }

    const record = proposeConfigMutation({
      projectPath: this.projectPath,
      operation,
      payload: input.input.payload,
    });
    new ConfigMutationStore(this.projectPath).saveProposal(record);
    return {
      output: JSON.stringify(record.proposal, null, 2),
      isError: record.proposal.status === "invalid",
    };
  }
}

export function createKilnConfigProposeChangeTool(projectPath: string): KilnConfigProposeChangeTool {
  return new KilnConfigProposeChangeTool(projectPath);
}

function parseOperation(value: unknown): KilnConfigMutationOperation | undefined {
  return typeof value === "string" && (KILN_CONFIG_MUTATION_OPERATIONS as readonly string[]).includes(value)
    ? value as KilnConfigMutationOperation
    : undefined;
}
