import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OperatorIdentityMark,
  OperatorStatusIndicator,
} from "../src/components/operator-identity-mark.js";

const assistantIdentity = {
  kind: "assistant",
  id: "codex-oauth:gpt-5.5",
  label: "Assistant",
  seed: "assistant:codex-oauth:gpt-5.5",
} as const;

describe("OperatorIdentityMark", () => {
  it("renders stable canonical initials without encoding runtime state", () => {
    render(<OperatorIdentityMark identity={assistantIdentity} />);

    expect(screen.getByLabelText("Assistant identity")).toHaveTextContent("AS");
    expect(screen.getByLabelText("Assistant identity")).toHaveAttribute("data-identity-kind", "assistant");
  });
});

describe("OperatorStatusIndicator", () => {
  it("communicates status with a stable symbol and optional visible label", () => {
    render(<OperatorStatusIndicator state="running" showLabel />);

    expect(screen.getByLabelText("Running status")).toHaveAttribute("data-operator-status", "running");
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
