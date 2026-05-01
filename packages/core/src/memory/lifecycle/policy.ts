import {
  defineMemoryScope,
  isMemoryLayerKind,
  type MemoryLayerKind,
  type MemoryScope,
} from "../domain/index.js";

export const MEMORY_LIFECYCLE_ACTION_TYPES = [
  "retain",
  "lower_recall_salience",
  "archive",
  "compact",
  "promote",
  "forget",
  "create_derived_summary",
] as const;

export type MemoryLifecycleActionType = typeof MEMORY_LIFECYCLE_ACTION_TYPES[number];

export const MEMORY_RETENTION_MODES = [
  "retain",
  "archive",
  "forget",
] as const;

export type MemoryRetentionMode = typeof MEMORY_RETENTION_MODES[number];

export const MEMORY_COMPACTION_STRATEGIES = [
  "summarize_by_topic",
  "merge_by_scope",
] as const;

export type MemoryCompactionStrategy = typeof MEMORY_COMPACTION_STRATEGIES[number];

export interface MemoryRetentionPolicy {
  readonly id: string;
  readonly layers: readonly MemoryLayerKind[];
  readonly mode: MemoryRetentionMode;
  readonly afterDays?: number;
  readonly immutable?: boolean;
}

export interface MemoryDecayPolicy {
  readonly id: string;
  readonly layers: readonly MemoryLayerKind[];
  readonly halfLifeDays: number;
  readonly minSalience: number;
  readonly allowSemanticDecay?: boolean;
}

export interface MemoryForgettingPolicy {
  readonly id: string;
  readonly layers: readonly MemoryLayerKind[];
  readonly mode: "soft_delete" | "redact";
  readonly requiresExplicitScope: boolean;
}

export interface MemoryCompactionPolicy {
  readonly id: string;
  readonly sourceLayers: readonly MemoryLayerKind[];
  readonly targetLayer: MemoryLayerKind;
  readonly strategy: MemoryCompactionStrategy;
  readonly minSourceRecords: number;
}

export interface MemoryPromotionPolicy {
  readonly id: string;
  readonly sourceLayers: readonly MemoryLayerKind[];
  readonly targetLayer: MemoryLayerKind;
  readonly minConfidence: number;
  readonly minUses?: number;
  readonly requireTopicKey?: boolean;
}

export interface MemoryLifecyclePolicySet {
  readonly id: string;
  readonly version: string;
  readonly retentionPolicies: readonly MemoryRetentionPolicy[];
  readonly decayPolicies: readonly MemoryDecayPolicy[];
  readonly forgettingPolicies: readonly MemoryForgettingPolicy[];
  readonly compactionPolicies: readonly MemoryCompactionPolicy[];
  readonly promotionPolicies: readonly MemoryPromotionPolicy[];
}

interface MemoryLifecycleActionBase {
  readonly type: MemoryLifecycleActionType;
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly layer: MemoryLayerKind;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly reason: string;
}

export type MemoryLifecycleAction =
  | (MemoryLifecycleActionBase & { readonly type: "retain" })
  | (MemoryLifecycleActionBase & { readonly type: "lower_recall_salience"; readonly targetSalience: number })
  | (MemoryLifecycleActionBase & { readonly type: "archive" })
  | (MemoryLifecycleActionBase & { readonly type: "compact"; readonly strategy: MemoryCompactionStrategy })
  | (MemoryLifecycleActionBase & { readonly type: "promote"; readonly targetLayer: MemoryLayerKind })
  | (MemoryLifecycleActionBase & { readonly type: "forget"; readonly mode: "soft_delete" | "redact" })
  | (MemoryLifecycleActionBase & { readonly type: "create_derived_summary"; readonly targetLayer: MemoryLayerKind });

export function createDefaultMemoryLifecyclePolicySet(input: {
  readonly id: string;
  readonly version: string;
}): MemoryLifecyclePolicySet {
  return validateMemoryLifecyclePolicySet({
    id: input.id,
    version: input.version,
    retentionPolicies: [
      {
        id: "semantic-retention",
        layers: ["semantic", "procedural"],
        mode: "retain",
      },
      {
        id: "audit-retention",
        layers: ["audit"],
        mode: "retain",
        immutable: true,
      },
    ],
    decayPolicies: [
      {
        id: "mutable-layer-decay",
        layers: ["working", "episodic", "coordination"],
        halfLifeDays: 30,
        minSalience: 0.15,
      },
    ],
    forgettingPolicies: [
      {
        id: "scoped-soft-delete",
        layers: ["working", "episodic", "semantic", "procedural", "coordination"],
        mode: "soft_delete",
        requiresExplicitScope: true,
      },
    ],
    compactionPolicies: [
      {
        id: "episodic-topic-compaction",
        sourceLayers: ["episodic", "coordination"],
        targetLayer: "semantic",
        strategy: "summarize_by_topic",
        minSourceRecords: 3,
      },
    ],
    promotionPolicies: [
      {
        id: "episodic-to-semantic-promotion",
        sourceLayers: ["working", "episodic"],
        targetLayer: "semantic",
        minConfidence: 0.7,
        minUses: 2,
        requireTopicKey: true,
      },
    ],
  });
}

export function isMemoryLifecycleActionType(value: string): value is MemoryLifecycleActionType {
  return (MEMORY_LIFECYCLE_ACTION_TYPES as readonly string[]).includes(value);
}

export function validateMemoryLifecyclePolicySet<T extends MemoryLifecyclePolicySet>(policySet: T): T {
  requiredText(policySet.id, "Memory lifecycle policy set id is required");
  requiredText(policySet.version, "Memory lifecycle policy set version is required");

  for (const policy of policySet.retentionPolicies) {
    validateRetentionPolicy(policy);
  }
  for (const policy of policySet.decayPolicies) {
    validateDecayPolicy(policy);
  }
  for (const policy of policySet.forgettingPolicies) {
    validateForgettingPolicy(policy);
  }
  for (const policy of policySet.compactionPolicies) {
    validateCompactionPolicy(policy);
  }
  for (const policy of policySet.promotionPolicies) {
    validatePromotionPolicy(policy);
  }

  return policySet;
}

export function validateMemoryLifecycleAction<T extends MemoryLifecycleAction>(action: T): T {
  if (!isMemoryLifecycleActionType(action.type)) {
    throw new Error("Unsupported memory lifecycle action type");
  }
  requiredText(action.recordId, "Memory lifecycle action record id is required");
  defineMemoryScope(action.scope);
  validateLayer(action.layer);
  requiredText(action.policyId, "Memory lifecycle action policy id is required");
  requiredText(action.policyVersion, "Memory lifecycle action policy version is required");
  requiredText(action.reason, "Memory lifecycle action reason is required");

  switch (action.type) {
    case "lower_recall_salience":
      validateUnitInterval(action.targetSalience, "Memory lifecycle salience must be between 0 and 1");
      break;
    case "compact":
      validateCompactionStrategy(action.strategy);
      break;
    case "promote":
    case "create_derived_summary":
      validateLayer(action.targetLayer);
      if (action.targetLayer === "audit") {
        throw new Error("Lifecycle actions cannot create audit memory");
      }
      break;
    case "forget":
      if (action.layer === "audit") {
        throw new Error("Audit memory cannot be forgotten by lifecycle policy");
      }
      break;
    case "retain":
    case "archive":
      break;
  }

  return action;
}

function validateRetentionPolicy(policy: MemoryRetentionPolicy): void {
  requiredText(policy.id, "Memory lifecycle retention policy id is required");
  validateLayers(policy.layers);
  if (!MEMORY_RETENTION_MODES.includes(policy.mode)) {
    throw new Error("Unsupported memory lifecycle retention mode");
  }
  if (policy.afterDays !== undefined) {
    validatePositiveInteger(policy.afterDays, "Memory lifecycle retention afterDays must be a positive integer");
  }
  if (policy.layers.includes("audit") && (policy.mode !== "retain" || policy.immutable !== true)) {
    throw new Error("Audit memory retention must be immutable retain");
  }
}

function validateDecayPolicy(policy: MemoryDecayPolicy): void {
  requiredText(policy.id, "Memory lifecycle decay policy id is required");
  validateLayers(policy.layers);
  if (policy.layers.includes("audit")) {
    throw new Error("Audit memory cannot be decayed");
  }
  if (policy.layers.includes("semantic") && policy.allowSemanticDecay !== true) {
    throw new Error("Semantic memory decay requires explicit allowSemanticDecay");
  }
  validatePositiveInteger(policy.halfLifeDays, "Memory lifecycle decay halfLifeDays must be a positive integer");
  validateUnitInterval(policy.minSalience, "Memory lifecycle salience must be between 0 and 1");
}

function validateForgettingPolicy(policy: MemoryForgettingPolicy): void {
  requiredText(policy.id, "Memory lifecycle forgetting policy id is required");
  validateLayers(policy.layers);
  if (policy.layers.includes("audit")) {
    throw new Error("Audit memory cannot be forgotten by lifecycle policy");
  }
  if (policy.mode !== "soft_delete" && policy.mode !== "redact") {
    throw new Error("Unsupported memory lifecycle forgetting mode");
  }
  if (policy.requiresExplicitScope !== true) {
    throw new Error("Memory lifecycle forgetting requires explicit scope");
  }
}

function validateCompactionPolicy(policy: MemoryCompactionPolicy): void {
  requiredText(policy.id, "Memory lifecycle compaction policy id is required");
  validateLayers(policy.sourceLayers);
  validateLayer(policy.targetLayer);
  if (policy.sourceLayers.includes("audit")) {
    throw new Error("Audit memory cannot be compacted");
  }
  if (policy.targetLayer === "audit") {
    throw new Error("Lifecycle compaction cannot target audit memory");
  }
  validateCompactionStrategy(policy.strategy);
  validatePositiveInteger(policy.minSourceRecords, "Memory lifecycle compaction minSourceRecords must be a positive integer");
}

function validatePromotionPolicy(policy: MemoryPromotionPolicy): void {
  requiredText(policy.id, "Memory lifecycle promotion policy id is required");
  validateLayers(policy.sourceLayers);
  validateLayer(policy.targetLayer);
  if (policy.sourceLayers.includes("audit")) {
    throw new Error("Audit memory cannot be promoted");
  }
  if (policy.targetLayer === "audit") {
    throw new Error("Lifecycle promotion cannot target audit memory");
  }
  validateUnitInterval(policy.minConfidence, "Memory lifecycle promotion minConfidence must be between 0 and 1");
  if (policy.minUses !== undefined) {
    validatePositiveInteger(policy.minUses, "Memory lifecycle promotion minUses must be a positive integer");
  }
}

function validateLayers(layers: readonly MemoryLayerKind[]): void {
  if (layers.length === 0) {
    throw new Error("Memory lifecycle policy requires at least one layer");
  }
  for (const layer of layers) {
    validateLayer(layer);
  }
}

function validateLayer(layer: MemoryLayerKind): void {
  if (!isMemoryLayerKind(layer)) {
    throw new Error("Unsupported memory lifecycle layer");
  }
}

function validateCompactionStrategy(strategy: MemoryCompactionStrategy): void {
  if (!MEMORY_COMPACTION_STRATEGIES.includes(strategy)) {
    throw new Error("Unsupported memory lifecycle compaction strategy");
  }
}

function validatePositiveInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }
}

function validateUnitInterval(value: number, message: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(message);
  }
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
