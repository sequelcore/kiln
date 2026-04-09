export interface PlanSubmission {
  readonly plan: string;
}

export const PLAN_EXIT_TOOL_NAME = "submit_plan";

export const planExitToolSchema = {
  name: PLAN_EXIT_TOOL_NAME,
  description: "Submit the completed implementation plan. Call this when exploration is done and the plan is ready for user review.",
  inputSchema: {
    type: "object" as const,
    properties: {
      plan: { type: "string", description: "The complete proposed plan in the required format." },
    },
    required: ["plan"],
  },
};
