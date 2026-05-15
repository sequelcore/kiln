export interface ResearchSource {
  readonly id: string;
  readonly title: string;
  readonly topic: string;
  readonly date: string;
  readonly summary: string;
  readonly findings: readonly string[];
}

const sources: ResearchSource[] = [
  {
    id: "SRC-001",
    title: "Gateway Surface Adoption Notes",
    topic: "runtime surfaces",
    date: "2026-04-10",
    summary: "Operator teams adopt GUI, TUI, native, and API surfaces for different deployment constraints.",
    findings: [
      "GUI fits shared remote workspaces when exposed behind trusted access controls.",
      "TUI fits terminal-first operators and low-bandwidth remote access.",
      "API and gateway channels fit product integrations that need stable HTTP boundaries.",
    ],
  },
  {
    id: "SRC-002",
    title: "Tool Authority Review",
    topic: "tool execution",
    date: "2026-04-18",
    summary: "Tool exposure should be explicit, scoped, and auditable.",
    findings: [
      "Read-only tools are easier to expose broadly than destructive tools.",
      "Destructive tools need clear schemas, audit records, and operator-visible authority.",
      "Tool descriptions should state operational limits instead of relying on prompt wording alone.",
    ],
  },
  {
    id: "SRC-003",
    title: "Tenant Memory Isolation Check",
    topic: "memory",
    date: "2026-05-02",
    summary: "Tenant-scoped memory keeps customer context from leaking across apps or tenants.",
    findings: [
      "Tenant ID must be resolved before storing or recalling conversational context.",
      "Memory paths should be derived from gateway state rather than client-provided file paths.",
      "Status and observability may report health without exposing stored memory contents.",
    ],
  },
];

const savedBriefs: Array<{ topic: string; summary: string; citations: string[]; savedAt: string }> = [];

export function searchSources(query: string): ResearchSource[] {
  const normalized = query.toLowerCase();
  return sources.filter((source) =>
    [source.title, source.topic, source.summary, ...source.findings]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function readSource(sourceId: string): ResearchSource | undefined {
  return sources.find((source) => source.id === sourceId);
}

export function saveBrief(topic: string, summary: string, citations: string[]) {
  const record = { topic, summary, citations, savedAt: new Date().toISOString() };
  savedBriefs.push(record);
  return { saved: true, briefId: `BRIEF-${String(savedBriefs.length).padStart(4, "0")}`, ...record };
}
