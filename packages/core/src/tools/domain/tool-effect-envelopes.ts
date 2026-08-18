/**
 * Declared effect envelopes for every canonical builtin tool.
 *
 * These are catalog-time, immutable, core-owned declarations of
 * the maximum semantic effects each tool can produce.
 *
 * Invariant: every DevToolName must have an entry in BUILTIN_TOOL_EFFECT_ENVELOPES.
 * The exhaustive test in action-effect-envelope.test.ts enforces this.
 *
 * Envelopes use sorted arrays for boundaries and consequences
 * to enable JSON serialization and subset comparison.
 */

import type {
  ActionEffectEnvelope,
  BoundaryType,
  ConsequenceType,
  DataEgressType,
  IdempotencyType,
  IdentityUseType,
  OperationType,
  ReversibilityType,
} from "../../engine/domain/action-effect.js";
import type { DevToolName } from "./tool.js";

// --- Convenience constructors for common patterns ---

const OBSERVE_NONE_EGRESS: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "idempotent" as IdempotencyType,
};

const OBSERVE_METADATA_EGRESS: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "idempotent" as IdempotencyType,
};

const FILE_MUTATION: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "irreversible" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const FILE_MUTATION_COMPENSATABLE: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "compensatable" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

const SHELL_COMMAND: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "workspace", "machine", "network", "external-system"] as readonly BoundaryType[],
  reversibility: "unknown" as ReversibilityType,
  dataEgress: "unknown" as DataEgressType,
  identityUse: "unknown" as IdentityUseType,
  consequences: ["local-state", "external-state", "security", "unknown"] as readonly ConsequenceType[],
  idempotency: "unknown" as IdempotencyType,
};

const WEB_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "network", "external-system"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

const GIT_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "authenticated" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "idempotent" as IdempotencyType,
};

const BROWSER_SESSION: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "machine", "network", "external-system"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["external-state"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const BROWSER_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "network", "external-system"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

const BROWSER_ACTION: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "machine", "network", "external-system"] as readonly BoundaryType[],
  reversibility: "irreversible" as ReversibilityType,
  dataEgress: "sensitive-data" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["external-state", "security"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const COMPUTER_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "machine"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

const COMPUTER_ACTION: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "machine"] as readonly BoundaryType[],
  reversibility: "irreversible" as ReversibilityType,
  dataEgress: "sensitive-data" as DataEgressType,
  identityUse: "authenticated" as IdentityUseType,
  consequences: ["external-state", "security"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const MONITOR_START: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "machine"] as readonly BoundaryType[],
  reversibility: "compensatable" as ReversibilityType,
  dataEgress: "metadata" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const MONITOR_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

const OPERATOR_ELICIT: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "sensitive-data" as DataEgressType,
  identityUse: "authenticated" as IdentityUseType,
  consequences: ["local-state", "security"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const MEMORY_MUTATE: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "project-data" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "non-idempotent" as IdempotencyType,
};

const OBSERVE_PROJECT_DATA_EGRESS: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "project-data" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "idempotent" as IdempotencyType,
};

const MEMORY_OBSERVE: ActionEffectEnvelope = {
  operation: "observe" as OperationType,
  boundaries: ["process", "workspace"] as readonly BoundaryType[],
  reversibility: "reversible" as ReversibilityType,
  dataEgress: "project-data" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: [] as readonly ConsequenceType[],
  idempotency: "idempotent" as IdempotencyType,
};

/**
 * Runs an external verifier process over workspace sources and writes its
 * verification log beside them.
 *
 * Declared as a mutation rather than an observation: the run is analytically
 * read-only, but it spawns a machine-boundary process and leaves a log file
 * behind. Declaring it `observe` would understate the authority an invocation
 * actually needs, and tool authority derives from this envelope.
 *
 * Idempotency is conditional: the same source yields the same proof, but a
 * resource or time limit can turn a discharged obligation into an unresolved
 * one between runs.
 */
const VERIFIER_EXECUTION: ActionEffectEnvelope = {
  operation: "mutate" as OperationType,
  boundaries: ["process", "workspace", "machine"] as readonly BoundaryType[],
  reversibility: "compensatable" as ReversibilityType,
  dataEgress: "none" as DataEgressType,
  identityUse: "none" as IdentityUseType,
  consequences: ["local-state"] as readonly ConsequenceType[],
  idempotency: "conditionally-idempotent" as IdempotencyType,
};

/**
 * Complete declared effect envelopes for all builtin developer tools.
 *
 * These represent the MAXIMUM effects each tool can produce.
 * Input-sensitive resolution may narrow these per invocation.
 */
export const BUILTIN_TOOL_EFFECT_ENVELOPES: Record<DevToolName, ActionEffectEnvelope> = {
  // --- Shell and file tools ---
  bash: SHELL_COMMAND,
  read: OBSERVE_NONE_EGRESS,
  read_many: {
    operation: "observe" as OperationType,
    boundaries: ["process", "workspace"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "metadata" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: [] as readonly ConsequenceType[],
    idempotency: "idempotent" as IdempotencyType,
  },
  write: FILE_MUTATION,
  edit: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "workspace"] as readonly BoundaryType[],
    reversibility: "compensatable" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "conditionally-idempotent" as IdempotencyType,
  },
  patch: FILE_MUTATION_COMPENSATABLE,

  // --- Inspection tools ---
  stat: OBSERVE_METADATA_EGRESS,
  tree: OBSERVE_METADATA_EGRESS,

  // --- Image/OCR tools ---
  view_image: {
    operation: "observe" as OperationType,
    boundaries: ["process", "workspace"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "metadata" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: [] as readonly ConsequenceType[],
    idempotency: "idempotent" as IdempotencyType,
  },
  ocr_image: {
    operation: "observe" as OperationType,
    boundaries: ["process", "workspace"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "project-data" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: [] as readonly ConsequenceType[],
    idempotency: "idempotent" as IdempotencyType,
  },

  // --- Web tools ---
  web_search: WEB_OBSERVE,
  web_fetch: WEB_OBSERVE,
  web_extract: WEB_OBSERVE,

  // --- Browser tools ---
  browser_session_start: BROWSER_SESSION,
  browser_navigate: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "network", "external-system"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "metadata" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["external-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },
  browser_observe: BROWSER_OBSERVE,
  browser_click: BROWSER_ACTION,
  browser_type: {
    ...BROWSER_ACTION,
    dataEgress: "sensitive-data" as DataEgressType,
    identityUse: "authenticated" as IdentityUseType,
    consequences: ["external-state", "security"] as readonly ConsequenceType[],
  },
  browser_keypress: BROWSER_ACTION,
  browser_scroll: {
    operation: "mutate" as OperationType,
    boundaries: ["process"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },
  browser_session_stop: BROWSER_SESSION,

  // --- Computer tools ---
  computer_observe: COMPUTER_OBSERVE,
  computer_click: COMPUTER_ACTION,
  computer_type: {
    ...COMPUTER_ACTION,
    dataEgress: "sensitive-data" as DataEgressType,
  },
  computer_keypress: COMPUTER_ACTION,
  computer_open_application: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "machine"] as readonly BoundaryType[],
    reversibility: "compensatable" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },
  computer_focus_application: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "machine"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "conditionally-idempotent" as IdempotencyType,
  },
  computer_minimize_application: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "machine"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "conditionally-idempotent" as IdempotencyType,
  },
  computer_close_application: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "machine"] as readonly BoundaryType[],
    reversibility: "compensatable" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },

  // --- Search tools ---
  grep: OBSERVE_NONE_EGRESS,
  glob: OBSERVE_NONE_EGRESS,
  json_query: OBSERVE_PROJECT_DATA_EGRESS,
  git: GIT_OBSERVE,
  code_intelligence: OBSERVE_METADATA_EGRESS,

  // --- Monitor lifecycle tools ---
  monitor_start: MONITOR_START,
  monitor_read: MONITOR_OBSERVE,
  monitor_stop: {
    operation: "mutate" as OperationType,
    boundaries: ["process", "machine"] as readonly BoundaryType[],
    reversibility: "irreversible" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },
  monitor_list: MONITOR_OBSERVE,

  // --- Task state tools ---
  task_list: {
    operation: "observe" as OperationType,
    boundaries: ["process"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "none" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: [] as readonly ConsequenceType[],
    idempotency: "idempotent" as IdempotencyType,
  },
  task_update: {
    operation: "mutate" as OperationType,
    boundaries: ["process"] as readonly BoundaryType[],
    reversibility: "reversible" as ReversibilityType,
    dataEgress: "metadata" as DataEgressType,
    identityUse: "none" as IdentityUseType,
    consequences: ["local-state"] as readonly ConsequenceType[],
    idempotency: "non-idempotent" as IdempotencyType,
  },

  // --- Operator tools ---
  operator_elicit: OPERATOR_ELICIT,

  // --- Discovery ---
  tool_catalog_search: OBSERVE_METADATA_EGRESS,

  // --- Memory ---
  memory_search: MEMORY_OBSERVE,
  memory_save: MEMORY_MUTATE,

  // --- Resource tools ---
  resource_list: OBSERVE_METADATA_EGRESS,
  resource_template_list: OBSERVE_METADATA_EGRESS,
  resource_read: OBSERVE_METADATA_EGRESS,

  // --- Verification ---
  formal_verify: VERIFIER_EXECUTION,
} as const;

/**
 * Get the declared effect envelope for a builtin tool name.
 * Returns CONSERVATIVE_UNKNOWN_ENVELOPE for unknown tool names.
 */
export function getBuiltinEffectEnvelope(toolName: string): ActionEffectEnvelope | undefined {
  if (toolName in BUILTIN_TOOL_EFFECT_ENVELOPES) {
    return BUILTIN_TOOL_EFFECT_ENVELOPES[toolName as DevToolName];
  }
  return undefined;
}
