import { z } from "zod";

export const GUI_MEMORY_LATTICE_SCOPE_KINDS = [
  "user",
  "agent",
  "team",
  "project",
  "org",
  "app",
  "tenant",
  "session",
] as const;

export const GUI_MEMORY_LATTICE_LAYER_KINDS = [
  "working",
  "episodic",
  "semantic",
  "procedural",
  "coordination",
  "audit",
] as const;

export const GUI_MEMORY_LATTICE_RELATION_TYPES = [
  "related_to",
  "supports",
  "contradicts",
  "supersedes",
  "revises",
  "derived_from",
  "same_topic",
  "admitted_to_context",
  "linked_resource",
  "belongs_to_scope",
] as const;

export const GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH = 160;

export const GuiMemoryLatticeScopeSchema = z.object({
  kind: z.enum(GUI_MEMORY_LATTICE_SCOPE_KINDS),
  id: z.string().min(1),
});

export const GuiMemoryLatticeNodeLifecycleEvidenceSchema = z.object({
  tags: z.array(z.string()),
  relationTypes: z.array(z.enum(GUI_MEMORY_LATTICE_RELATION_TYPES)),
  revisionCount: z.number().int().nonnegative(),
  admissionCount: z.number().int().nonnegative(),
  latestAdmissionDecision: z.enum(["admitted", "deferred"]).optional(),
});

export const GuiMemoryLatticeGraphNodeSchema = z.object({
  id: z.string().min(1),
  recordId: z.string().min(1),
  layer: z.enum(GUI_MEMORY_LATTICE_LAYER_KINDS),
  scope: GuiMemoryLatticeScopeSchema,
  label: z.string(),
  score: z.number().optional(),
  lifecycleEvidence: GuiMemoryLatticeNodeLifecycleEvidenceSchema.optional(),
});

export const GuiMemoryLatticeGraphEdgeSchema = z.object({
  id: z.string().min(1),
  sourceRecordId: z.string().min(1),
  targetRecordId: z.string().min(1),
  relationType: z.enum(GUI_MEMORY_LATTICE_RELATION_TYPES),
});

export const GuiMemoryLatticeGraphSnapshotSchema = z.object({
  nodes: z.array(GuiMemoryLatticeGraphNodeSchema),
  edges: z.array(GuiMemoryLatticeGraphEdgeSchema),
  limits: z.object({
    maxNodes: z.number().int().positive(),
    maxEdges: z.number().int().positive(),
  }),
  truncated: z.boolean(),
});

export const GuiMemoryLatticeGraphFiltersSchema = z.object({
  scope: GuiMemoryLatticeScopeSchema.optional(),
  layer: z.enum(GUI_MEMORY_LATTICE_LAYER_KINDS).optional(),
  query: z.string().max(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH).optional(),
  depth: z.number().int().nonnegative(),
});

export const GuiMemoryLatticeGraphResponseSchema = z.object({
  snapshot: GuiMemoryLatticeGraphSnapshotSchema,
  filters: GuiMemoryLatticeGraphFiltersSchema,
});

export const GuiMemoryLatticeGraphRequestSchema = z.object({
  scope: GuiMemoryLatticeScopeSchema.optional(),
  layer: z.enum(GUI_MEMORY_LATTICE_LAYER_KINDS).optional(),
  query: z.string().max(GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH).optional(),
  depth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const GuiMemoryLatticeErrorSchema = z.object({
  code: z.enum(["invalid_memory_lattice_request", "memory_lattice_unavailable"]),
  message: z.string().min(1),
});

export type GuiMemoryLatticeScopeKind = typeof GUI_MEMORY_LATTICE_SCOPE_KINDS[number];
export type GuiMemoryLatticeLayerKind = typeof GUI_MEMORY_LATTICE_LAYER_KINDS[number];
export type GuiMemoryLatticeRelationType = typeof GUI_MEMORY_LATTICE_RELATION_TYPES[number];
export type GuiMemoryLatticeScope = z.infer<typeof GuiMemoryLatticeScopeSchema>;
export type GuiMemoryLatticeNodeLifecycleEvidence = z.infer<typeof GuiMemoryLatticeNodeLifecycleEvidenceSchema>;
export type GuiMemoryLatticeGraphNode = z.infer<typeof GuiMemoryLatticeGraphNodeSchema>;
export type GuiMemoryLatticeGraphEdge = z.infer<typeof GuiMemoryLatticeGraphEdgeSchema>;
export type GuiMemoryLatticeGraphSnapshot = z.infer<typeof GuiMemoryLatticeGraphSnapshotSchema>;
export type GuiMemoryLatticeGraphFilters = z.infer<typeof GuiMemoryLatticeGraphFiltersSchema>;
export type GuiMemoryLatticeGraphRequest = z.infer<typeof GuiMemoryLatticeGraphRequestSchema>;
export type GuiMemoryLatticeGraphResponse = z.infer<typeof GuiMemoryLatticeGraphResponseSchema>;
export type GuiMemoryLatticeError = z.infer<typeof GuiMemoryLatticeErrorSchema>;
