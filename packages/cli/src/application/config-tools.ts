import type { DevTool } from "@kilnai/core";
import { createKilnConfigApplyChangeTool } from "./config-apply-tool.js";
import { createKilnConfigProposeChangeTool } from "./config-propose-tool.js";
import { createKilnConfigReadTool } from "./config-read-tool.js";

export function createKilnConfigTools(projectPath: string): readonly DevTool[] {
  return [
    createKilnConfigReadTool(projectPath),
    createKilnConfigProposeChangeTool(projectPath),
    createKilnConfigApplyChangeTool(projectPath),
  ];
}
