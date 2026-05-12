import { describe, expect, it } from "vitest";
import { SpecificationStateStore } from "../../../src/tools/infrastructure/specification-state-store.js";

describe("specification state store", () => {
  it("reports the full Slice 1 validation taxonomy and blocks unresolved required fields", () => {
    const store = new SpecificationStateStore({ now: () => 1_800_000_000_000 });

    const specification = store.upsertSpecification({
      title: "Incomplete specification",
      objective: "TBD",
      nonGoals: [],
      successCriteria: ["Maybe it works later."],
      actors: [],
      dataLifecycle: "",
      uxEdgeCases: [],
      securityPrivacy: "TBD",
      externalDependencies: [],
      completionSignals: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-1",
        instructionProfileIds: ["sequel-engineering"],
      },
    });

    expect(specification.status).toBe("draft");
    expect(specification.issues.map((issue) => issue.code)).toEqual([
      "ambiguity",
      "missing_non_goals",
      "vague_success_criteria",
      "undefined_actors",
      "unclear_data_lifecycle",
      "ux_edge_cases",
      "security_privacy_posture",
      "external_dependencies",
      "completion_signals",
    ]);
    expect(specification.issues.filter((issue) => issue.blocking).map((issue) => issue.code)).toEqual([
      "ambiguity",
      "missing_non_goals",
      "vague_success_criteria",
      "undefined_actors",
      "unclear_data_lifecycle",
      "security_privacy_posture",
      "completion_signals",
    ]);
  });

  it("merges clarifications into affected specification sections without duplicate or contradictory answers", () => {
    const store = new SpecificationStateStore({ now: () => 1_800_000_000_000 });
    const draft = store.upsertSpecification({
      title: "Clarified specification",
      objective: "TBD",
      nonGoals: [],
      successCriteria: ["Maybe validate later."],
      actors: [],
      dataLifecycle: "",
      uxEdgeCases: [],
      securityPrivacy: "TBD",
      externalDependencies: [],
      completionSignals: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-1",
        instructionProfileIds: ["sequel-engineering"],
      },
    });

    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What objective is in scope?",
      answer: "Deliver canonical structured specification intake.",
      affectedSection: "objective",
      rationale: "Planning needs a concrete objective.",
    })).toMatchObject({ specification: { objective: "Deliver canonical structured specification intake." } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What is out of scope?",
      answer: "Do not implement goal execution.",
      affectedSection: "nonGoals",
      rationale: "Goal execution belongs to a later slice.",
    })).toMatchObject({ specification: { nonGoals: ["Do not implement goal execution."] } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What proves completion?",
      answer: "Specification resources replay from session state.",
      affectedSection: "successCriteria",
      rationale: "Completion needs executable proof.",
    })).toMatchObject({ specification: { successCriteria: ["Specification resources replay from session state."] } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "Who uses this?",
      answer: "operator",
      affectedSection: "actors",
      rationale: "Actors are required for planning.",
    })).toMatchObject({ specification: { actors: ["operator"] } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "How is data scoped?",
      answer: "Session-scoped specification and clarification resources only.",
      affectedSection: "dataLifecycle",
      rationale: "The lifecycle must be explicit.",
    })).toMatchObject({ specification: { dataLifecycle: "Session-scoped specification and clarification resources only." } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What is the security posture?",
      answer: "No secrets are stored in specification artifacts.",
      affectedSection: "securityPrivacy",
      rationale: "The security posture must be explicit.",
    })).toMatchObject({ specification: { securityPrivacy: "No secrets are stored in specification artifacts." } });
    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What external dependencies exist?",
      answer: "none",
      affectedSection: "externalDependencies",
      rationale: "Dependencies must be declared.",
    })).toMatchObject({ specification: { externalDependencies: ["none"] } });
    const completed = store.recordClarification({
      specificationId: draft.id,
      question: "What is the closeout signal?",
      answer: "Focused tests and docs confirm Slice 1 behavior.",
      affectedSection: "completionSignals",
      rationale: "Closeout must be observable.",
    });

    expect(completed).toMatchObject({
      specification: {
        status: "ready_for_plan",
        issues: [
          {
            code: "ux_edge_cases",
            blocking: false,
          },
        ],
      },
    });

    const duplicate = store.recordClarification({
      specificationId: draft.id,
      question: "What is the closeout signal?",
      answer: "Focused tests and docs confirm Slice 1 behavior.",
      affectedSection: "completionSignals",
      rationale: "Same answer is idempotent.",
    });
    expect("clarification" in duplicate && duplicate.clarification.id).toBe(
      "clarification" in completed ? completed.clarification.id : undefined,
    );

    expect(store.recordClarification({
      specificationId: draft.id,
      question: "What is the closeout signal?",
      answer: "A different signal.",
      affectedSection: "completionSignals",
      rationale: "Conflicting answer should fail.",
    })).toEqual({
      error: "Clarification contradicts an existing answer for the same affected section and question.",
    });
  });
});
