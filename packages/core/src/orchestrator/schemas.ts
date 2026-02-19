/**
 * Structured output JSON schemas for Architect agent responses.
 * Used with Anthropic's `output_config.format` for constrained decoding.
 * All schemas require `additionalProperties: false` at every object level.
 */

/** Architect's implementation plan after analyzing the codebase */
export const ARCHITECT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique task identifier" },
          statement: {
            type: "string",
            description: "What this task accomplishes",
          },
          priority: {
            type: "number",
            description: "Priority score (0-1, higher = more important)",
          },
          parentId: {
            type: ["string", "null"],
            description: "Parent task ID for subtasks",
          },
        },
        required: ["id", "statement", "priority", "parentId"],
        additionalProperties: false,
      },
      description: "Ordered list of implementation tasks",
    },
    approach: {
      type: "string",
      description: "Overall implementation strategy",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Identified risks and concerns",
    },
    estimatedComplexity: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Overall complexity estimate",
    },
  },
  required: ["tasks", "approach", "risks", "estimatedComplexity"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

/** Architect evaluates a Worker's task results */
export const ARCHITECT_EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    taskId: {
      type: "string",
      description: "ID of the evaluated task",
    },
    action: {
      type: "string",
      enum: ["deepen", "branch", "prune"],
      description:
        "Tree action: deepen (subtask), branch (alternative), prune (abandon)",
    },
    reasoning: {
      type: "string",
      description: "Why this action was chosen",
    },
    newTask: {
      type: ["object", "null"],
      properties: {
        statement: { type: "string", description: "New task description" },
        priority: { type: "number", description: "Priority score (0-1)" },
      },
      required: ["statement", "priority"],
      additionalProperties: false,
      description: "New task for deepen/branch actions (null for prune)",
    },
    gatesPassed: {
      type: "boolean",
      description: "Whether quality gates passed for this task",
    },
  },
  required: ["taskId", "action", "reasoning", "newTask", "gatesPassed"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

/** Architect reviews implementation before Verify phase */
export const ARCHITECT_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    approved: {
      type: "boolean",
      description: "Whether the implementation is approved",
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "File path" },
          line: {
            type: ["number", "null"],
            description: "Line number (null if file-level)",
          },
          description: { type: "string", description: "Issue description" },
          severity: {
            type: "string",
            enum: ["error", "warning", "info"],
            description: "Issue severity",
          },
        },
        required: ["file", "line", "description", "severity"],
        additionalProperties: false,
      },
      description: "Issues found during review",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "Improvement suggestions",
    },
  },
  required: ["approved", "issues", "suggestions"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;
