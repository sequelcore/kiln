import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defineMemoryAuthorityPolicy,
  MemoryGraphResourceProvider,
  SqliteMemoryRepository,
  ToolCatalogIndex,
  ToolResourceRegistry,
  MonitorRegistry,
  TaskStateStore,
  ResourceListTool,
  ResourceReadTool,
  ResourceTemplateListTool,
  type CreateMemoryRecordInput,
  type MemoryLayerKind,
  type MemoryProvenance,
  type MemoryRepository,
} from "../../../src/index.js";

describe("MemoryGraphResourceProvider", () => {
  let tmpDir: string;
  let repository: SqliteMemoryRepository;
  let registry: ToolResourceRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-resources-"));
    repository = new SqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    registry = new ToolResourceRegistry({
      catalog: new ToolCatalogIndex([]),
      monitorRegistry: new MonitorRegistry(),
      taskStateStore: new TaskStateStore(),
      providers: [new MemoryGraphResourceProvider({ repository })],
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists memory graph resources and templates through the canonical registry and model-callable tools", async () => {
    expect(registry.list().map((resource) => resource.uri)).toContain("kiln://memory/graph");
    expect(registry.listTemplates().map((template) => template.uriTemplate)).toEqual(expect.arrayContaining([
      "kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}",
      "kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}",
      "kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}",
      "kiln://memory/nodes/{id}/neighbors{?scope,scopeKind,scopeId,depth,limit}",
      "kiln://memory/nodes/{id}/provenance{?scope,scopeKind,scopeId}",
      "kiln://memory/relations/{id}{?scope,scopeKind,scopeId}",
      "kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}",
    ]));

    const listResult = await new ResourceListTool({ resources: () => registry }).execute({ input: { limit: 10 } });
    const templateResult = await new ResourceTemplateListTool({ resources: () => registry }).execute({ input: { limit: 20 } });

    expect(listResult.isError).toBe(false);
    expect(JSON.parse(listResult.output).resources.map((resource: { uri: string }) => resource.uri)).toContain("kiln://memory/graph");
    expect(templateResult.isError).toBe(false);
    expect(JSON.parse(templateResult.output).resourceTemplates.map((template: { uriTemplate: string }) => template.uriTemplate)).toEqual(
      expect.arrayContaining([
        "kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}",
        "kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}",
      ]),
    );
  });

  it("reads bounded graph resources with scope, query, depth, and limit filters", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Memory lattice root.", topicKey: "root" }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Memory lattice child.", topicKey: "child" }));
    repository.saveRecord(recordInput({ id: "other", content: "Memory lattice other scope.", topicKey: "other", scopeId: "other" }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));

    const result = await registry.read("kiln://memory/graph?scope=project%3Akiln&query=lattice&depth=1&limit=2");
    const payload = JSON.parse(result.contents[0]!.text);

    expect(payload.snapshot.nodes.map((node: { recordId: string }) => node.recordId)).toEqual([child.id, root.id]);
    expect(payload.snapshot.edges.map((edge: { id: string }) => edge.id)).toEqual(["relation-1"]);
    expect(payload.snapshot.limits).toEqual({ maxNodes: 2, maxEdges: 4 });
    expect(payload.filters).toMatchObject({ scope: { kind: "project", id: "kiln" }, query: "lattice", depth: 1 });
  });

  it("reads node detail, provenance, neighbors, relation, and admission resources", async () => {
    const root = repository.saveRecord(recordInput({
      id: "root",
      content: "Root memory.",
      topicKey: "root",
      tags: ["memory", "lifecycle:active", "lifecycle:promoted"],
    }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    const relation = repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));
    const sibling = repository.saveRecord(recordInput({ id: "sibling", content: "Sibling memory.", topicKey: "sibling" }));
    repository.saveRelation(relationInput("relation-2", root.id, sibling.id, "supports"));
    repository.saveRelation(relationInput("relation-3", root.id, child.id, "related_to"));
    repository.saveRevision({
      id: "revision-1",
      recordId: root.id,
      sequence: 1,
      kind: "created",
      content: root.content,
      createdAt: "2026-04-30T12:01:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-1",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-1",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:02:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-2",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-2",
      decision: "deferred",
      reason: "Deferred for context budget.",
      estimatedTokens: 10,
      baseScore: 0.5,
      effectiveScore: 0.5,
      createdAt: "2026-04-30T12:03:00.000Z",
    });

    const node = JSON.parse((await registry.read("kiln://memory/nodes/root?scope=project%3Akiln")).contents[0]!.text);
    const provenance = JSON.parse((await registry.read("kiln://memory/nodes/root/provenance?scope=project%3Akiln")).contents[0]!.text);
    const neighbors = JSON.parse((await registry.read("kiln://memory/nodes/root/neighbors?depth=1&limit=5&scope=project%3Akiln")).contents[0]!.text);
    const relationPayload = JSON.parse((await registry.read("kiln://memory/relations/relation-1?scope=project%3Akiln")).contents[0]!.text);
    const admissions = JSON.parse((await registry.read("kiln://memory/admissions?recordId=root&sessionId=session-1&limit=5")).contents[0]!.text);

    expect(node.record).toMatchObject({ id: root.id, content: "Root memory." });
    expect(node.revisions.map((revision: { id: string }) => revision.id)).toEqual(["revision-1"]);
    expect(node.relations.map((candidate: { id: string }) => candidate.id)).toEqual([relation.id, "relation-2", "relation-3"]);
    expect(node.lifecycleEvidence).toEqual({
      tags: ["lifecycle:active", "lifecycle:promoted"],
      relationTypes: ["related_to", "supports"],
      revisionCount: 1,
      admissionCount: 2,
      latestAdmissionDecision: "deferred",
    });
    expect(provenance.provenance).toEqual(root.provenance);
    expect(provenance.admissions.map((admission: { id: string }) => admission.id)).toEqual(["admission-1", "admission-2"]);
    expect(neighbors.snapshot.nodes.map((graphNode: { recordId: string }) => graphNode.recordId)).toEqual([root.id, child.id, sibling.id]);
    expect(relationPayload.relation).toMatchObject(relation);
    expect(admissions.admissions.map((admission: { id: string }) => admission.id)).toEqual(["admission-1", "admission-2"]);
  });

  it("reads dedicated lifecycle resources with bounded evidence and scoped relation filtering", async () => {
    const root = repository.saveRecord(recordInput({
      id: "root",
      content: "Root memory.",
      topicKey: "root",
      tags: ["memory", "lifecycle:stale", "lifecycle:active", "operator"],
    }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    const foreign = repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));
    repository.saveRelation(relationInput("relation-2", root.id, child.id, "related_to"));
    repository.saveRelation(relationInput("relation-3", root.id, foreign.id, "contradicts"));
    repository.saveRevision({
      id: "revision-1",
      recordId: root.id,
      sequence: 1,
      kind: "created",
      content: root.content,
      createdAt: "2026-04-30T12:01:00.000Z",
    });
    repository.saveRevision({
      id: "revision-2",
      recordId: root.id,
      parentRevisionId: "revision-1",
      sequence: 2,
      kind: "extended",
      content: "Root memory v2.",
      createdAt: "2026-04-30T12:02:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-1",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-1",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:02:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-2",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-2",
      decision: "deferred",
      reason: "Deferred for context budget.",
      estimatedTokens: 10,
      baseScore: 0.5,
      effectiveScore: 0.5,
      createdAt: "2026-04-30T12:03:00.000Z",
    });

    const lifecycle = JSON.parse((await registry.read("kiln://memory/nodes/root/lifecycle?scope=project%3Akiln")).contents[0]!.text);

    expect(lifecycle.recordId).toBe(root.id);
    expect(lifecycle.lifecycle).toEqual({
      tags: ["lifecycle:active", "lifecycle:stale"],
      relationTypes: ["related_to", "supports"],
      revisionCount: 2,
      admissionCount: 2,
      latestAdmissionDecision: "deferred",
    });
    expect(lifecycle.evidence.revisions.map((revision: { id: string }) => revision.id)).toEqual(["revision-2", "revision-1"]);
    expect(lifecycle.evidence.relations.map((relation: { id: string }) => relation.id)).toEqual(["relation-1", "relation-2"]);
    expect(lifecycle.evidence.admissions.map((admission: { id: string }) => admission.id)).toEqual(["admission-2", "admission-1"]);
    expect(lifecycle.truncated).toBe(false);
  });

  it("reads lifecycle newest-tail evidence and summary when revisions and admissions overflow", async () => {
    const root = repository.saveRecord(recordInput({
      id: "root",
      content: "Root memory.",
      topicKey: "root",
      tags: ["memory", "lifecycle:active"],
    }));

    for (let index = 1; index <= 52; index += 1) {
      repository.saveRevision({
        id: `revision-${index}`,
        recordId: root.id,
        ...(index > 1 ? { parentRevisionId: `revision-${index - 1}` } : {}),
        sequence: index,
        kind: index === 1 ? "created" : "extended",
        content: `Revision ${index}.`,
        createdAt: new Date(Date.UTC(2026, 3, 30, 10, 0, index)).toISOString(),
      });
    }
    for (let index = 1; index <= 502; index += 1) {
      repository.saveContextAdmission({
        id: `admission-${index}`,
        recordId: root.id,
        sessionId: "session-1",
        turnId: `turn-${index}`,
        decision: index === 502 ? "deferred" : "admitted",
        reason: "Lifecycle regression test.",
        estimatedTokens: 12,
        baseScore: 1,
        effectiveScore: 1,
        createdAt: new Date(Date.UTC(2026, 3, 30, 12, 0, index)).toISOString(),
      });
    }

    const lifecycle = JSON.parse((await registry.read("kiln://memory/nodes/root/lifecycle?scope=project%3Akiln")).contents[0]!.text);
    const node = JSON.parse((await registry.read("kiln://memory/nodes/root?scope=project%3Akiln")).contents[0]!.text);
    const graph = JSON.parse((await registry.read("kiln://memory/graph?scope=project%3Akiln&depth=0&limit=5")).contents[0]!.text);
    const graphRoot = graph.snapshot.nodes.find((candidate: { recordId: string }) => candidate.recordId === root.id);

    expect(lifecycle.lifecycle.latestAdmissionDecision).toBe("deferred");
    expect(node.lifecycleEvidence.latestAdmissionDecision).toBe("deferred");
    expect(graphRoot.lifecycleEvidence.latestAdmissionDecision).toBe("deferred");
    expect(lifecycle.lifecycle.revisionCount).toBe(50);
    expect(lifecycle.lifecycle.admissionCount).toBe(50);
    expect(lifecycle.evidence.revisions).toHaveLength(50);
    expect(lifecycle.evidence.admissions).toHaveLength(50);
    expect(lifecycle.evidence.revisions.map((revision: { id: string }) => revision.id)).toContain("revision-52");
    expect(lifecycle.evidence.revisions.map((revision: { id: string }) => revision.id)).not.toContain("revision-1");
    expect(lifecycle.evidence.revisions.map((revision: { id: string }) => revision.id)).not.toContain("revision-2");
    expect(lifecycle.evidence.admissions.map((admission: { id: string }) => admission.id)).toContain("admission-502");
    expect(lifecycle.evidence.admissions.map((admission: { id: string }) => admission.id)).not.toContain("admission-1");
    expect(lifecycle.evidence.admissions.map((admission: { id: string }) => admission.id)).not.toContain("admission-2");
    expect(lifecycle.truncated).toBe(true);
  });

  it("projects lifecycle summaries on graph snapshot node payloads", async () => {
    const root = repository.saveRecord(recordInput({
      id: "root",
      content: "Root memory.",
      topicKey: "root",
      tags: ["memory", "lifecycle:compacted", "lifecycle:active"],
    }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));
    repository.saveRevision({
      id: "revision-1",
      recordId: root.id,
      sequence: 1,
      kind: "created",
      content: root.content,
      createdAt: "2026-04-30T12:01:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-1",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-1",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:02:00.000Z",
    });

    const graph = JSON.parse((await registry.read("kiln://memory/graph?scope=project%3Akiln&depth=1&limit=5")).contents[0]!.text);
    const rootNode = graph.snapshot.nodes.find((node: { recordId: string }) => node.recordId === root.id);

    expect(rootNode.lifecycleEvidence).toEqual({
      tags: ["lifecycle:active", "lifecycle:compacted"],
      relationTypes: ["supports"],
      revisionCount: 1,
      admissionCount: 1,
      latestAdmissionDecision: "admitted",
    });
  });

  it("does not surface soft-deleted records in graph or node resources", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const live = repository.saveRecord(recordInput({ id: "live", content: "Live memory.", topicKey: "live" }));
    const deleted = repository.saveRecord(recordInput({ id: "deleted", content: "Deleted memory.", topicKey: "deleted" }));
    repository.saveRelation(relationInput("relation-live", root.id, live.id, "related_to"));
    repository.saveRelation(relationInput("relation-deleted", root.id, deleted.id, "related_to"));
    repository.deleteRecord(deleted.id);

    const graph = JSON.parse((await registry.read("kiln://memory/graph?scope=project%3Akiln&depth=1&limit=10")).contents[0]!.text);
    const node = JSON.parse((await registry.read("kiln://memory/nodes/root?scope=project%3Akiln")).contents[0]!.text);

    expect(graph.snapshot.nodes.map((candidate: { recordId: string }) => candidate.recordId)).toEqual([live.id, root.id]);
    expect(graph.snapshot.edges.map((candidate: { id: string }) => candidate.id)).toEqual(["relation-live"]);
    expect(node.relations.map((relation: { id: string }) => relation.id)).toEqual(["relation-live"]);
    await expect(registry.read("kiln://memory/nodes/deleted?scope=project%3Akiln")).rejects.toThrow("Memory resource not found");
  });

  it("fails closed for invalid, stale, oversized, and cross-scope memory reads", async () => {
    repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const oversizedRegistry = new ToolResourceRegistry({
      catalog: new ToolCatalogIndex([]),
      monitorRegistry: new MonitorRegistry(),
      taskStateStore: new TaskStateStore(),
      providers: [new MemoryGraphResourceProvider({ repository, maxPayloadBytes: 120 })],
    });

    await expect(registry.read("kiln://memory/nodes/root?scope=project%3Aother")).rejects.toThrow("Memory resource not found");
    await expect(registry.read("kiln://memory/graph?limit=0")).rejects.toThrow("Memory resource limit must be a positive integer");
    await expect(registry.read("kiln://memory/graph?cursor=stale")).rejects.toThrow("Unsupported memory resource query parameter");
    await expect(oversizedRegistry.read("kiln://memory/nodes/root")).rejects.toThrow("Memory resource payload exceeds");
  });

  it("fails closed when a scoped relation points to a foreign target record", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const foreign = repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    repository.saveRelation(relationInput("relation-foreign", root.id, foreign.id, "related_to"));

    await expect(registry.read("kiln://memory/relations/relation-foreign?scope=project%3Akiln")).rejects.toThrow("Memory resource not found");
  });

  it("omits foreign relation targets from scoped node detail reads", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const local = repository.saveRecord(recordInput({ id: "local", content: "Local memory.", topicKey: "local" }));
    const foreign = repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    repository.saveRelation(relationInput("relation-local", root.id, local.id, "related_to"));
    repository.saveRelation(relationInput("relation-foreign", root.id, foreign.id, "related_to"));

    const node = JSON.parse((await registry.read("kiln://memory/nodes/root?scope=project%3Akiln")).contents[0]!.text);

    expect(node.relations.map((relation: { id: string }) => relation.id)).toEqual(["relation-local"]);
  });

  it("decodes path ids once and fails closed for malformed path escapes", async () => {
    repository.saveRecord(recordInput({ id: "root%", content: "Root memory.", topicKey: "root-percent" }));

    const node = JSON.parse((await registry.read("kiln://memory/nodes/root%25")).contents[0]!.text);

    expect(node.record.id).toBe("root%");
    await expect(registry.read("kiln://memory/nodes/root%")).rejects.toThrow("Invalid resource URI path encoding");
  });

  it("reports node detail truncation only when bounded relation or admission reads overflow", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    for (let index = 1; index <= 50; index += 1) {
      repository.saveRevision({
        id: `revision-${index}`,
        recordId: root.id,
        ...(index > 1 ? { parentRevisionId: `revision-${index - 1}` } : {}),
        sequence: index,
        kind: index === 1 ? "created" : "extended",
        content: `Revision ${index}.`,
        createdAt: `2026-04-30T11:${String(index).padStart(2, "0")}:00.000Z`,
      });
      repository.saveContextAdmission({
        id: `admission-${index}`,
        recordId: root.id,
        sessionId: "session-1",
        turnId: `turn-${index}`,
        decision: "admitted",
        reason: "Relevant memory.",
        estimatedTokens: 12,
        baseScore: 1,
        effectiveScore: 1,
        createdAt: `2026-04-30T12:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const exactLimit = JSON.parse((await registry.read("kiln://memory/nodes/root/provenance")).contents[0]!.text);
    expect(exactLimit.revisions).toHaveLength(50);
    expect(exactLimit.admissions).toHaveLength(50);
    expect(exactLimit.truncated).toBe(false);

    repository.saveRevision({
      id: "revision-51",
      recordId: root.id,
      parentRevisionId: "revision-50",
      sequence: 51,
      kind: "extended",
      content: "Revision 51.",
      createdAt: "2026-04-30T11:51:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-51",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-51",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:51:00.000Z",
    });
    for (let index = 1; index <= 51; index += 1) {
      const child = repository.saveRecord(recordInput({
        id: `child-${index}`,
        content: `Child memory ${index}.`,
        topicKey: `child-${index}`,
      }));
      repository.saveRelation(relationInput(`relation-${index}`, root.id, child.id, "related_to"));
    }

    const overflow = JSON.parse((await registry.read("kiln://memory/nodes/root")).contents[0]!.text);
    expect(overflow.revisions).toHaveLength(50);
    expect(overflow.relations).toHaveLength(50);
    expect(overflow.admissions).toHaveLength(50);
    expect(overflow.truncated).toBe(true);
  });

  it("detects admission truncation at the maximum public read limit", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    for (let index = 1; index <= 501; index += 1) {
      repository.saveContextAdmission({
        id: `admission-${index}`,
        recordId: root.id,
        sessionId: "session-1",
        turnId: `turn-${index}`,
        decision: "admitted",
        reason: "Relevant memory.",
        estimatedTokens: 12,
        baseScore: 1,
        effectiveScore: 1,
        createdAt: new Date(Date.UTC(2026, 3, 30, 12, 0, index)).toISOString(),
      });
    }

    const payload = JSON.parse((await registry.read("kiln://memory/admissions?recordId=root&limit=500")).contents[0]!.text);

    expect(payload.admissions).toHaveLength(500);
    expect(payload.truncated).toBe(true);
  });

  it("is readable through the model-callable resource_read tool", async () => {
    repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const tool = new ResourceReadTool({ resources: () => registry });

    const result = await tool.execute({ input: { uri: "kiln://memory/graph?query=root&limit=5" } });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output).snapshot.nodes.map((node: { recordId: string }) => node.recordId)).toEqual(["root"]);
  });

  it("allows read when authority matches requested scope and layer", async () => {
    repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const governedRegistry = createRegistryWithAuthority(repository);

    const payload = JSON.parse((await governedRegistry.read("kiln://memory/graph?scope=project%3Akiln&layer=semantic&limit=5")).contents[0]!.text);

    expect(payload.snapshot.nodes.map((node: { recordId: string }) => node.recordId)).toEqual(["root"]);
  });

  it("denies cross-scope graph reads under scoped read authority", async () => {
    repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    const governedRegistry = createRegistryWithAuthority(repository);

    await expect(governedRegistry.read("kiln://memory/graph?scope=project%3Aother&layer=semantic&limit=5")).rejects.toThrow("scope is not authorized");
  });

  it("denies graph reads that omit scope when authority requires scoped access", async () => {
    repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const governedRegistry = createRegistryWithAuthority(repository);

    await expect(governedRegistry.read("kiln://memory/graph?layer=semantic&limit=5")).rejects.toThrow("scope is required");
  });

  it("denies node reads outside the allowed scope even without scope query params", async () => {
    repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    const governedRegistry = createRegistryWithAuthority(repository);

    await expect(governedRegistry.read("kiln://memory/nodes/foreign")).rejects.toThrow("scope is not authorized");
  });

  it("denies reads for layers not allowed by authority", async () => {
    repository.saveRecord(recordInput({
      id: "episodic-node",
      content: "Episodic memory.",
      topicKey: "episodic-node",
      layer: "episodic",
    }));
    const governedRegistry = createRegistryWithAuthority(repository);

    await expect(governedRegistry.read("kiln://memory/nodes/episodic-node")).rejects.toThrow("layer is not authorized");
  });

  it("denies record-less admissions reads under zero-rule authority", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    repository.saveContextAdmission({
      id: "admission-1",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-1",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:02:00.000Z",
    });
    const zeroRuleRegistry = createRegistryWithZeroRuleAuthority(repository);

    await expect(
      zeroRuleRegistry.read("kiln://memory/admissions?scope=project%3Akiln&layer=semantic&sessionId=session-1&limit=5"),
    ).rejects.toThrow("operation is not authorized");
  });

  it("allows scoped record-less admissions reads under matching read authority", async () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const foreign = repository.saveRecord(recordInput({
      id: "foreign",
      content: "Foreign memory.",
      topicKey: "foreign",
      scopeId: "other",
    }));
    repository.saveContextAdmission({
      id: "admission-1",
      recordId: root.id,
      sessionId: "session-1",
      turnId: "turn-1",
      decision: "admitted",
      reason: "Relevant memory.",
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:02:00.000Z",
    });
    repository.saveContextAdmission({
      id: "admission-2",
      recordId: foreign.id,
      sessionId: "session-1",
      turnId: "turn-2",
      decision: "admitted",
      reason: "Foreign scope.",
      estimatedTokens: 8,
      baseScore: 0.7,
      effectiveScore: 0.7,
      createdAt: "2026-04-30T12:03:00.000Z",
    });
    const governedRegistry = createRegistryWithAuthority(repository);

    const payload = JSON.parse((
      await governedRegistry.read("kiln://memory/admissions?scope=project%3Akiln&layer=semantic&sessionId=session-1&limit=5")
    ).contents[0]!.text);

    expect(payload.admissions.map((admission: { recordId: string; id: string }) => ({
      id: admission.id,
      recordId: admission.recordId,
    }))).toEqual([{ id: "admission-1", recordId: root.id }]);
    expect(payload.truncated).toBe(false);
  });
});

function recordInput(overrides: {
  readonly id: string;
  readonly content: string;
  readonly topicKey: string;
  readonly scopeId?: string;
  readonly layer?: MemoryLayerKind;
  readonly tags?: readonly string[];
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: overrides.layer ?? "semantic",
    scope: {
      kind: "project",
      id: overrides.scopeId ?? "kiln",
    },
    content: overrides.content,
    tags: overrides.tags ?? ["memory"],
    topicKey: overrides.topicKey,
    provenance: provenance("seed"),
    createdAt: "2026-04-30T12:00:00.000Z",
  };
}

function relationInput(
  id: string,
  sourceRecordId: string,
  targetRecordId: string,
  type: "supports" | "related_to" | "contradicts" | "derived_from",
) {
  return {
    id,
    sourceRecordId,
    target: { kind: "memory_record" as const, id: targetRecordId },
    type,
    createdAt: "2026-04-30T12:00:00.000Z",
  };
}

function provenance(sourceId: string): MemoryProvenance {
  return {
    sourceType: "operator",
    sourceId,
    actor: "Ricardo Armenta",
    capturedAt: "2026-04-30T12:00:00.000Z",
  };
}

function createRegistryWithAuthority(repository: MemoryRepository): ToolResourceRegistry {
  return new ToolResourceRegistry({
    catalog: new ToolCatalogIndex([]),
    monitorRegistry: new MonitorRegistry(),
    taskStateStore: new TaskStateStore(),
    providers: [new MemoryGraphResourceProvider({
      repository,
      authority: defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-2a" },
        rules: [{
          access: "read",
          operations: ["read"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["semantic"],
        }],
      }),
    })],
  });
}

function createRegistryWithZeroRuleAuthority(repository: MemoryRepository): ToolResourceRegistry {
  return new ToolResourceRegistry({
    catalog: new ToolCatalogIndex([]),
    monitorRegistry: new MonitorRegistry(),
    taskStateStore: new TaskStateStore(),
    providers: [new MemoryGraphResourceProvider({
      repository,
      authority: defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-0z" },
        rules: [],
      }),
    })],
  });
}
