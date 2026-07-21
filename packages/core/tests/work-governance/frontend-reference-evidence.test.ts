import { describe, expect, it } from "vitest";
import {
  containsCodeBackedFrontendEvidence,
  containsFrontendReferenceEvidence,
  containsProductUiVisualEvidence,
} from "../../src/work-governance/index.js";

describe("frontend reference evidence", () => {
  it("accepts sourced product UI capture evidence", () => {
    expect(containsProductUiVisualEvidence(
      "Captured running vLLM Studio product UI screenshot from https://example.test/demo.png.",
    )).toBe(true);
    expect(containsProductUiVisualEvidence(
      "Technical workstation UI screenshot from https://example.test/workstation.png with reusable dense layout reference.",
    )).toBe(true);
  });

  it("accepts local code-backed frontend implementation evidence", () => {
    expect(containsCodeBackedFrontendEvidence([
      "Local repository /workspace/references/vllm-studio.",
      "Frontend implementation evidence from src/components/Workspace.tsx.",
      "Component structure, layout pattern, navigation model, typography, spacing, and density extracted.",
    ].join("\n"))).toBe(true);
    expect(containsCodeBackedFrontendEvidence([
      "Local source D:/DesignRefs/frontend-app/src/components/Shell.tsx.",
      "Code-backed frontend implementation evidence: component structure, navigation model, panel density, typography, and spacing.",
    ].join("\n"))).toBe(true);
    expect(containsCodeBackedFrontendEvidence([
      "Local source \\\\design-nas\\refs\\frontend-app\\src\\components\\Shell.tsx.",
      "Code-backed frontend implementation evidence: component structure, navigation model, panel density, typography, and spacing.",
    ].join("\n"))).toBe(true);
    expect(containsCodeBackedFrontendEvidence([
      "### C:\\workspace\\references\\opencode — Qualifying Frontend Found",
      "Key source paths:",
      "- packages/app/src/pages/layout.tsx — Main layout with sidebar rail, expandable panel, session list, project avatar",
      "- packages/app/src/pages/session.tsx — Session view with virtualized message timeline and inline composer dock",
      "- packages/app/src/components/prompt-input.tsx — Full composer with slash popover and context items",
      "Extracted UI principles: sidebar rail, virtualized timelines, dock surfaces, sticky activity headers, session tabs, typography, spacing, and density.",
    ].join("\n"))).toBe(true);
  });

  it("rejects repository chrome and placeholder evidence", () => {
    expect(containsFrontendReferenceEvidence(
      "GitHub repository files navigation with stars and forks from https://github.com/example/repo.",
    )).toBe(false);
    expect(containsFrontendReferenceEvidence(
      "Use <source URL> and <relevant frontend file path> for frontend implementation evidence.",
    )).toBe(false);
  });
});
