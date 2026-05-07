import type { DevTool, ToolInput, ToolResult } from "@kilnai/core";
import { KILN_CONFIG_CHANGE_OPERATIONS } from "@kilnai/gateway-contracts";
import type { KilnConfigChangeOperation } from "@kilnai/gateway-contracts";
import { ConfigMutationStore } from "./config-mutation-store.js";
import { createConfigChangeProposalRecord } from "./config-proposal.js";

export class KilnConfigProposeChangeTool implements DevTool {
  readonly name = "kiln_config.propose_change";
  readonly description = [
    "Create a validated canonical Kiln configuration-change proposal without writing files.",
    "Use this for skill.upsert, agent.upsert, and agent.attach_skills before any approved apply step.",
  ].join(" ");
  readonly annotations = {
    readOnly: true,
  };
  readonly inputSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: KILN_CONFIG_CHANGE_OPERATIONS,
        description: "Bounded config operation to propose.",
      },
      payload: {
        type: "object",
        description: "Operation-specific payload.",
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
        output: `Invalid kiln_config.propose_change operation. Valid operations: ${KILN_CONFIG_CHANGE_OPERATIONS.join(", ")}`,
        isError: true,
      };
    }

    const record = createConfigChangeProposalRecord({
      projectPath: this.projectPath,
      operation,
      payload: input.input.payload,
    });
    new ConfigMutationStore(this.projectPath).saveProposal(record);
    const proposal = record.proposal;
    return {
      output: JSON.stringify(proposal, null, 2),
      isError: proposal.status === "invalid",
    };
  }
}

export function createKilnConfigProposeChangeTool(projectPath: string): KilnConfigProposeChangeTool {
  return new KilnConfigProposeChangeTool(projectPath);
}

function parseOperation(value: unknown): KilnConfigChangeOperation | undefined {
  return typeof value === "string" && (KILN_CONFIG_CHANGE_OPERATIONS as readonly string[]).includes(value)
    ? value as KilnConfigChangeOperation
    : undefined;
}
