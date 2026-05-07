import type { DevTool, ToolInput, ToolResult } from "@kilnai/core";
import { KILN_CONFIG_READ_VIEWS } from "@kilnai/gateway-contracts";
import type { KilnConfigReadView } from "@kilnai/gateway-contracts";
import {
  isConfigReadView,
  readConfigStatusSnapshot,
  readConfigStatusView,
} from "./config-status.js";

export class KilnConfigReadTool implements DevTool {
  readonly name = "kiln_config.read";
  readonly description = [
    "Read canonical Kiln configuration/status views through the governed config-status contract.",
    "Use this instead of reading YAML, AGENTS.md, CLAUDE.md, Codex, Claude Code, or OpenCode files directly when inspecting Kiln setup.",
  ].join(" ");
  readonly annotations = {
    readOnly: true,
    idempotent: true,
  };
  readonly inputSchema = {
    type: "object",
    properties: {
      view: {
        type: "string",
        enum: KILN_CONFIG_READ_VIEWS,
        description: "Config/status view to read.",
      },
    },
    required: ["view"],
    additionalProperties: false,
  };

  constructor(private readonly projectPath: string) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const view = parseView(input.input.view);
    if (!view) {
      return {
        output: `Invalid kiln_config.read view. Valid views: ${KILN_CONFIG_READ_VIEWS.join(", ")}`,
        isError: true,
      };
    }

    const snapshot = await readConfigStatusSnapshot({ projectPath: this.projectPath });
    const result = await readConfigStatusView(snapshot, view);
    return {
      output: JSON.stringify(result.value, null, 2),
      isError: false,
    };
  }
}

export function createKilnConfigReadTool(projectPath: string): KilnConfigReadTool {
  return new KilnConfigReadTool(projectPath);
}

function parseView(value: unknown): KilnConfigReadView | undefined {
  return typeof value === "string" && isConfigReadView(value) ? value : undefined;
}
