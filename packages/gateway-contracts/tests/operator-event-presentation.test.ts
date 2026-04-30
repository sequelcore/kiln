import { describe, expect, it } from "vitest";
import {
  formatOperatorEventValue,
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
} from "../src/operator-event-presentation.js";

describe("operator event presentation", () => {
  it("presents provider routing without exposing raw payload syntax", () => {
    const presentation = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
      reason: "Explicit model override",
    });

    expect(presentation.title).toBe("Provider routed");
    expect(presentation.summary).toBe("codex-oauth · gpt-5.5");
    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.5" },
      { label: "Why", value: "Explicit model override" },
    ]);
    expect(JSON.stringify(presentation.details)).not.toContain("\\\"provider\\\"");
  });

  it("presents turn completion nested data as operator detail rows", () => {
    const presentation = presentOperatorEventPayload("turn_completed", {
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      outcome: "completed",
      runtimeContinuity: {
        strategy: "fallback-replay",
        selectionReason: "no-sources",
      },
      authorityStatus: {
        effective: "destructive",
      },
      inputTokens: 1398,
      outputTokens: 11,
    });

    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Outcome", value: "completed" },
      { label: "Continuity", value: "fallback-replay" },
      { label: "Why", value: "no-sources" },
      { label: "Authority", value: "destructive" },
      { label: "Input tokens", value: "1398" },
      { label: "Output tokens", value: "11" },
    ]);
  });

  it("formats nested values as structured values for compact surfaces", () => {
    expect(formatOperatorEventValue({ nested: true })).toBe("Structured value");
  });

  it("marks live tool calls as inline conversation events and audit events", () => {
    const started = presentOperatorEventPayload("tool_call_started", {
      toolCallId: "tool-1",
      toolName: "read_many",
      input: {
        paths: ["docs"],
        maxBytes: 200000,
      },
    });
    const completed = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: "24 files read, 109 skipped",
      status: { state: "succeeded" },
    });

    expect(started.title).toBe("Using read_many");
    expect(started.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(operatorEventTargetsSurface(started, "conversation_inline")).toBe(true);

    expect(completed.title).toBe("Completed read_many");
    expect(completed.summary).toBe("24 files read, 109 skipped");
    expect(completed.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("keeps low-signal runtime telemetry out of the inline transcript", () => {
    const routed = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
    });
    const cost = presentOperatorEventPayload("cost_updated", {
      cost: { deltaUsd: 0.0012 },
      usage: { inputTokens: 100, outputTokens: 25 },
    });

    expect(operatorEventTargetsSurface(routed, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(cost, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(routed, "activity_panel")).toBe(true);
    expect(operatorEventTargetsSurface(cost, "activity_panel")).toBe(true);
  });

  it("summarizes JSON-shaped tool output before it reaches inline surfaces", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.summary).not.toContain("metadata");
  });

  it("unwraps nested JSON tool envelopes before rendering read previews", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: JSON.stringify({
          output: "# Session Model\n\nKiln session identity is provider-agnostic.",
          isError: false,
          metadata: {
            toolName: "read",
            kind: "file",
            operation: "read",
            filePath: "docs/architecture/session-model.md",
          },
        }),
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      title: "docs/architecture/session-model.md",
      summary: "# Session Model",
      preview: {
        text: "# Session Model\n\nKiln session identity is provider-agnostic.",
      },
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("\"output\"");
  });

  it("projects patch results as first-class diff presentations", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "patch",
      outputSummary: JSON.stringify({
        output: "1 file changed, 18 additions, 6 removals",
        isError: false,
        metadata: {
          toolName: "patch",
          kind: "file",
          operation: "patch",
          filePath: "packages/gui/src/components/transcript.tsx",
          fileCount: 1,
          linesAdded: 18,
          linesRemoved: 6,
          diffPreview: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
          diffTruncated: true,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "packages/gui/src/components/transcript.tsx",
      summary: "1 file changed, 18 additions, 6 removals",
      raw: { available: true },
    });
    expect(presentation.toolPresentation?.fields).toEqual(expect.arrayContaining([
      { label: "Files", value: "1" },
      { label: "Additions", value: "18" },
      { label: "Removals", value: "6" },
    ]));
    expect(presentation.toolPresentation?.preview).toEqual({
      text: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
      truncated: true,
    });
  });

  it("projects high-volume resource linked outputs without exposing raw packets inline", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: JSON.stringify({
        output: "--- C:\\Proyectos\\Sequel\\kiln\\docs\\architecture.md\n# Kiln Architecture",
        isError: false,
        metadata: {
          toolName: "read_many",
          kind: "file",
          operation: "read_many",
          fileCount: 24,
          skippedCount: 109,
          totalBytes: 200000,
          truncated: true,
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_1/content",
              title: "read_many full output",
              mimeType: "text/plain",
              size: 200000,
              relation: "full_output",
            },
          ],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("24 files read, 109 skipped, 200000 bytes, truncated");
    expect(presentation.summary).not.toContain("--- C:");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "resource_links",
      title: "read_many full output",
      summary: "24 files read, 109 skipped, 200000 bytes, truncated",
    });
    expect(presentation.toolPresentation?.resourceLinks).toEqual([
      expect.objectContaining({
        uri: "kiln://artifacts/tool-results/artifact_1/content",
        title: "read_many full output",
      }),
    ]);
  });
});
