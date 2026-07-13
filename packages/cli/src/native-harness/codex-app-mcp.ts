#!/usr/bin/env bun

process.stdin.pause();

try {
  const { startCodexAppMcpServer } = await import("./codex-app-mcp-server.js");
  await startCodexAppMcpServer();
  process.stdin.resume();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Kiln Codex App MCP startup failed");
  process.exitCode = 1;
}
