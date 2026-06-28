import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperatorAvatar } from "../src/components/operator-avatar.js";

const assistantIdentity = {
  kind: "assistant",
  label: "Assistant",
  seed: "codex-oauth/gpt-5.5",
} as const;

describe("OperatorAvatar", () => {
  it("uses Facehash identity affordances for idle avatars", () => {
    const { container } = render(<OperatorAvatar identity={assistantIdentity} state="idle" />);

    expect(screen.getByLabelText("Assistant avatar")).toHaveAttribute("data-avatar-state", "idle");
    const facehash = container.querySelector("[data-facehash]");
    expect(facehash).toHaveClass("font-semibold", "text-white/95");
    expect(facehash).not.toHaveAttribute("data-interactive");
    expect(container.querySelector("[data-facehash-initial]")).toHaveTextContent("C");
    expect(container.querySelector("[data-facehash-gradient]")).toHaveClass("bg-[radial-gradient(ellipse_at_35%_22%,rgba(255,255,255,0.38),rgba(255,255,255,0.12)_38%,transparent_72%)]");
  });

  it("uses custom status mouth and blink only for animated running avatars", () => {
    const { container } = render(<OperatorAvatar identity={assistantIdentity} state="running" motion="subtle" />);

    expect(screen.getByLabelText("Assistant avatar")).toHaveAttribute("data-avatar-state", "running");
    expect(container.querySelector("[data-facehash-mouth]")).not.toBeNull();
    expect(container.querySelector("[data-facehash-initial]")).toBeNull();
    expect(container.querySelector("[data-facehash]")).toHaveAttribute("data-interactive", "true");
  });

  it("keeps error avatars stable instead of interactive", () => {
    const { container } = render(<OperatorAvatar identity={assistantIdentity} state="error" motion="subtle" />);

    expect(screen.getByLabelText("Assistant avatar")).toHaveAttribute("data-avatar-state", "error");
    expect(container.querySelector("[data-facehash]")).not.toHaveAttribute("data-interactive");
    expect(container.querySelector("[data-facehash-mouth]")).not.toBeNull();
  });
});
