#!/usr/bin/env bun

import { startCodexAppMcpServer } from "./codex-app-mcp-server.js";

void startCodexAppMcpServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Kiln Codex App MCP startup failed");
  process.exitCode = 1;
});
