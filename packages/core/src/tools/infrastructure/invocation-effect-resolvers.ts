import type {
  ActionEffectEnvelope,
  IdempotencyType,
  InvocationEffectResolver,
  InvocationEffectResolverRegistry,
} from "../../engine/domain/action-effect.js";
import { DeterministicDangerousCommandDetector } from "../../security/dangerous-command-detector.js";

const OBSERVE_PROCESS: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const OBSERVE_WORKSPACE: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const PATCH_APPLY: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "compensatable",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "conditionally-idempotent",
};

const PATCH_DRY_RUN: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const BROWSER_OBSERVE_PLAIN: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "network", "external-system"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const BROWSER_TYPE_SENSITIVE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "network", "external-system"],
  reversibility: "irreversible",
  dataEgress: "sensitive-data",
  identityUse: "authenticated",
  consequences: ["external-state", "security"],
  idempotency: "non-idempotent",
};

const ELICIT_URL: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "external-system"],
  reversibility: "reversible",
  dataEgress: "sensitive-data",
  identityUse: "authenticated",
  consequences: ["local-state", "security"],
  idempotency: "non-idempotent",
};

const ELICIT_SENSITIVE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "sensitive-data",
  identityUse: "authenticated",
  consequences: ["local-state", "security"],
  idempotency: "non-idempotent",
};

const ELICIT_FORM: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

const COMPUTER_OBSERVE_PLAIN: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "machine"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const MEMORY_SAVE_NARROW: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

const MEMORY_SAVE_WIDE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "project-data",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

const MONITOR_START_MUTATION: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "machine"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

const dangerousCommandDetector = new DeterministicDangerousCommandDetector();

const bashResolver: InvocationEffectResolver = (_toolName, input, envelope) => {
  const command = typeof input.command === "string" ? input.command : "";
  if (!command.trim()) {
    return OBSERVE_PROCESS;
  }
  const decision = dangerousCommandDetector.evaluate({ command, shell: "bash" });
  if (decision.action === "allow") {
    return OBSERVE_WORKSPACE;
  }
  return envelope;
};

const patchResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  if (input.dryRun === true) {
    return PATCH_DRY_RUN;
  }
  return PATCH_APPLY;
};

const browserObserveResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  if (input.includeScreenshot !== true) {
    return BROWSER_OBSERVE_PLAIN;
  }
  return _envelope;
};

const browserTypeResolver: InvocationEffectResolver = (_toolName, input, envelope) => {
  if (input.sensitive === true) {
    return BROWSER_TYPE_SENSITIVE;
  }
  return envelope;
};

const operatorElicitResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  const mode = typeof input.mode === "string" ? input.mode : "form";
  if (mode === "url") {
    return ELICIT_URL;
  }
  if (input.sensitive === true) {
    return ELICIT_SENSITIVE;
  }
  return ELICIT_FORM;
};

const memorySaveResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  const scopeKind = typeof input.scopeKind === "string" ? input.scopeKind : "session";
  const hasId = typeof input.id === "string" && input.id.length > 0;
  const isWideScope = ["project", "org", "team", "user"].includes(scopeKind);
  const base = isWideScope ? MEMORY_SAVE_WIDE : MEMORY_SAVE_NARROW;
  if (hasId) {
    return { ...base, idempotency: "conditionally-idempotent" as IdempotencyType };
  }
  return base;
};

const computerObserveResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  if (input.includeScreenshot !== true) {
    return COMPUTER_OBSERVE_PLAIN;
  }
  return _envelope;
};

const monitorStartResolver: InvocationEffectResolver = (_toolName, input, _envelope) => {
  const command = typeof input.command === "string" ? input.command : "";
  if (!command.trim()) {
    return OBSERVE_PROCESS;
  }
  return MONITOR_START_MUTATION;
};

export function buildBuiltinInvocationEffectResolvers(): InvocationEffectResolverRegistry {
  return new Map<string, InvocationEffectResolver>([
    ["bash", bashResolver],
    ["patch", patchResolver],
    ["browser_observe", browserObserveResolver],
    ["browser_type", browserTypeResolver],
    ["computer_observe", computerObserveResolver],
    ["operator_elicit", operatorElicitResolver],
    ["memory_save", memorySaveResolver],
    ["monitor_start", monitorStartResolver],
  ]);
}
