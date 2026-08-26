import { describe, expect, it, vi } from "vitest";
import type { ToolResultPresentation } from "@kilnai/gateway-contracts";

vi.mock("@opentui/core", () => ({
  BoxRenderable: class {},
  TextRenderable: class { content = ""; },
  MarkdownRenderable: class {},
  SyntaxStyle: { create: () => ({}) },
  t: (strings: TemplateStringsArray, ...values: readonly unknown[]) =>
    strings.reduce((text, chunk, index) => `${text}${chunk}${String(values[index] ?? "")}`, ""),
  fg: () => (text: string) => text,
}));

import { handleToolResult, type HandlerContext } from "../src/handlers.js";
import { createReactiveState, type Message } from "../src/state.js";

describe("TUI verification handler", () => {
  it("replaces the generic completed row with structured verification evidence", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const message: Message = { role: "tool", content: "", toolName: "formal_verify", toolCallId: "formal-1" };
    const node = { content: "" };
    const ctx = {
      state: createReactiveState(),
      theme: () => ({ toolFg: "", text: "", textMuted: "" }),
      messageNodes: [{ msg: message, node }],
    } as unknown as HandlerContext;
    const presentation: ToolResultPresentation = {
      outputKind: "verification",
      classification: { source: "tool-metadata", reason: "synthetic verification fixture" },
      title: "Dafny formal verification",
      fields: [],
      verification: {
        kind: "formal",
        engine: { name: "dafny", version: "4.11.0" },
        candidate: { digest, subjects: [{ path: "policy.dfy", contentDigest: digest }] },
        outcome: "proved",
        totals: { total: 1, proved: 1, refuted: 0, unresolved: 0 },
        checks: [{ label: "Allow", outcome: "proved", durationMs: 12, resourceCount: 1_840 }],
        authority: { kind: "evidence_only", establishes: [] },
      },
      raw: { available: false },
    };

    handleToolResult(ctx, "formal_verify", "generic output", "formal-1", presentation);

    expect(message.content).toContain("1/1 obligations proved · 1,840 RU");
    expect(node.content).toContain("✓ Allow · 1,840 RU · 12 ms");
    expect(node.content).toContain("Assurance: separate decision · evidence only");
  });
});
