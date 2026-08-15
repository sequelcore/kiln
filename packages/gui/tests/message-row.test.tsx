import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRow } from "../src/components/message-row.js";
import { useSessionStore } from "../src/lib/session-store/index.js";

describe("MessageRow", () => {
  beforeEach(() => {
    useSessionStore.setState({ messages: [], outboundSend: null });
  });
  it("composes official shadcn message and bubble primitives", () => {
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-primitives",
          role: "user",
          content: "Use the conversation primitives.",
          createdAt: "2026-06-28T00:00:00.000Z",
          parts: [],
        }}
      />,
    );

    const message = container.querySelector('[data-slot="message"]');
    const bubble = container.querySelector('[data-slot="bubble"]');
    expect(message).toHaveAttribute("data-align", "end");
    expect(message).toContainElement(bubble);
  });

  it("renders assistant markdown lists and GFM tables with visible structure", () => {
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-markdown",
          role: "assistant",
          content: [
            "Checklist:",
            "",
            "- Provider discovery",
            "- GUI rendering",
            "",
            "| Surface | Status |",
            "| --- | --- |",
            "| Chat | fixed |",
          ].join("\n"),
          createdAt: "2026-05-16T00:00:00.000Z",
          parts: [],
        }}
      />,
    );

    expect(screen.getByRole("list")).toHaveClass("list-disc");
    expect(screen.getByText("Provider discovery").closest("li")).toHaveClass("pl-1");
    const table = screen.getByRole("table");
    expect(table).toHaveClass("border-collapse");
    expect(table).toHaveClass("min-w-full", "w-max");
    const scrollArea = table.closest('[data-markdown-table-scroll]');
    expect(scrollArea).toHaveClass("max-w-full");
    expect(scrollArea?.querySelector('[data-slot="scroll-area-viewport"]')).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Surface" })).toHaveClass("bg-background-element");
    expect(screen.getByRole("cell", { name: "fixed" })).toBeInTheDocument();
    expect(container.querySelector(".markdown-body")).not.toBeNull();
  });

  it("keeps wide markdown tables horizontally scrollable instead of squeezing columns", () => {
    render(
      <MessageRow
        message={{
          id: "msg-wide-markdown-table",
          role: "assistant",
          content: [
            "| Skill | configured | origin | builtIn | sourcePath | claude projection | codex projection | opencode projection | admission.state | admission.reason | Current session status / omission reason |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            "| shadcn | true | user | false | C:\\Users\\ExampleUser\\.kiln\\skills\\shadcn\\SKILL.md | projected | projected | projected | available | Configured Kiln skill. | Admitted in this current session; available for explicit admission/request. |",
          ].join("\n"),
          createdAt: "2026-06-28T00:00:00.000Z",
          parts: [],
        }}
      />,
    );

    const table = screen.getByRole("table");
    expect(table.closest('[data-markdown-table-scroll]')).toHaveAttribute(
      "aria-label",
      "Scrollable markdown table",
    );
    expect(table).toHaveClass("w-max", "min-w-full", "table-auto");
    expect(screen.getByRole("columnheader", { name: "Current session status / omission reason" })).toHaveClass("min-w-36");
    expect(screen.getByRole("cell", { name: /C:\\Users\\ExampleUser/ })).toHaveClass("min-w-40");
  });

  it("keeps assistant metadata and markdown content aligned without a redundant avatar column", () => {
    useSessionStore.setState({
      executionRouteCatalog: {
        routes: [{
          routeId: "claude-current",
          label: "Claude current",
          providerId: "claude",
          providerModelId: "claude-sonnet-4-6",
          accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
          availability: "available",
          reasonCodes: [],
          repairActions: [],
        }],
      },
      activeRouteId: "claude-current",
    });
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-assistant-layout",
          role: "assistant",
          content: "Mi team de agentes configurado en Kiln para esta sesión es:",
          routedProvider: "codex-oauth",
          routedModel: "gpt-5.5",
          sourceMessageId: "runtime-message-layout",
          createdAt: "2026-06-28T00:00:00.000Z",
          parts: [],
        }}
      />,
    );

    const header = container.querySelector('[data-slot="message-header"]');
    const bubbleContent = container.querySelector('[data-slot="bubble-content"]');
    expect(container.querySelector('[data-slot="message-avatar"]')).toBeNull();
    expect(header?.querySelector('[data-provider-brand="codex"]')).not.toBeNull();
    expect(header?.querySelector('[data-provider-brand="claude"]')).toBeNull();
    expect(header).toHaveClass("min-h-5", "leading-5");
    expect(bubbleContent).toHaveClass("group-data-[variant=ghost]/bubble:overflow-visible");
    expect(screen.getByText("Mi team de agentes configurado en Kiln para esta sesión es:")).toBeInTheDocument();
  });

  it("renders assistant audio parts as compact playback actions", async () => {
    const loadResourceDataUrl = vi.fn().mockResolvedValue("data:audio/mpeg;base64,AQID");
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-1",
          role: "assistant",
          content: "Here is the spoken answer.",
          createdAt: "2026-05-15T00:00:00.000Z",
          parts: [
            { type: "text", text: "Here is the spoken answer." },
            { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content" },
          ],
        }}
        loadResourceDataUrl={loadResourceDataUrl}
      />,
    );

    expect(screen.getByText("Here is the spoken answer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audio output" })).toBeInTheDocument();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("data:audio/mpeg;base64,AQID");
    expect(screen.queryByRole("link", { name: "Open audio artifact" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open audio artifact" }));

    await waitFor(() => {
      expect(loadResourceDataUrl).toHaveBeenCalledWith("kiln://artifacts/voice-synthesis/artifact_1/content");
    });
    expect(screen.getByLabelText("Audio artifact preview")).toHaveAttribute("src", "data:audio/mpeg;base64,AQID");
  });

  it("renders a compact on-demand audio action for canonical assistant messages without audio", () => {
    render(
      <MessageRow
        message={{
          id: "msg-2",
          role: "assistant",
          content: "Generate audio when requested.",
          sourceMessageId: "runtime-message-2",
          createdAt: "2026-05-15T00:00:00.000Z",
          parts: [{ type: "text", text: "Generate audio when requested." }],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate audio" })).toBeInTheDocument();
  });

  it("uses the active execution target only as streaming display evidence", () => {
    useSessionStore.setState({
      executionRouteCatalog: {
        routes: [{
          routeId: "terra",
          label: "Terra",
          providerId: "codex-oauth",
          providerModelId: "gpt-5.6-terra",
          accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: "available",
          reasonCodes: [],
          repairActions: [],
        }],
      },
      activeRouteId: "terra",
    });

    const { container } = render(
      <MessageRow
        message={{
          id: "streaming-route-evidence",
          role: "assistant",
          content: "Streaming response.",
          createdAt: "2026-08-11T00:00:00.000Z",
          streaming: true,
          parts: [],
        }}
      />,
    );

    expect(screen.getByText("Codex OAuth / gpt-5.6-terra")).toBeInTheDocument();
    expect(container.querySelector('[data-provider-brand="codex"]')).not.toBeNull();
  });

  it("keeps voice synthesis failure and retry on the source message", () => {
    const outboundSend = vi.fn();
    const message = {
      id: "msg-voice-failed",
      role: "assistant" as const,
      content: "Generate audio when requested.",
      sourceMessageId: "runtime-message-voice-failed",
      createdAt: "2026-05-15T00:00:00.000Z",
      parts: [{ type: "text" as const, text: "Generate audio when requested." }],
      voiceSynthesisStatus: "error" as const,
      voiceSynthesisFailure: "Speech synthesis is unavailable.",
    };
    useSessionStore.setState({ messages: [message], outboundSend });
    render(
      <MessageRow
        message={message}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry audio generation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Speech synthesis is unavailable.");
    expect(outboundSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "voice_synthesis_request",
      sourceMessageId: "runtime-message-voice-failed",
    }));
  });
});
