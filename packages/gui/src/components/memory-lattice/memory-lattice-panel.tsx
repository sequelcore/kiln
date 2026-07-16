import { lazy, Suspense, useEffect, useState } from "react";
import type {
  GuiMemoryLatticeGraphNode,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  GuiMemoryLatticeLayerKind,
  GuiMemoryLatticeScopeKind,
} from "@kilnai/gateway-contracts";
import {
  GUI_MEMORY_LATTICE_LAYER_KINDS,
  GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH,
  GUI_MEMORY_LATTICE_SCOPE_KINDS,
} from "@kilnai/gateway-contracts";
import { Network, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MemoryLatticePanelProps {
  readonly filters: GuiMemoryLatticeGraphRequest;
  readonly response: GuiMemoryLatticeGraphResponse | null | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly selectedRecordId: string | null;
  readonly onRefresh: () => void;
  readonly onFiltersChange: (filters: GuiMemoryLatticeGraphRequest) => void;
  readonly onSelectRecord: (recordId: string) => void;
  readonly graphOpen?: boolean;
  readonly onOpenGraph?: () => void;
}

type MemoryGraphEdge = GuiMemoryLatticeGraphResponse["snapshot"]["edges"][number];

const EMPTY_LAYER = "all";
const EMPTY_SCOPE = "any";
const EMPTY_MEMORY_NODES: readonly GuiMemoryLatticeGraphNode[] = [];
const EMPTY_MEMORY_EDGES: readonly MemoryGraphEdge[] = [];
const MemoryGraphScene = lazy(async () => {
  const module = await import("./memory-graph-scene.js");
  return { default: module.MemoryGraphScene };
});

export function MemoryLatticePanel(props: MemoryLatticePanelProps) {
  const [draftQuery, setDraftQuery] = useState(normalizeDraftQuery(props.filters.query ?? ""));
  const [draftScopeKind, setDraftScopeKind] = useState<GuiMemoryLatticeScopeKind | typeof EMPTY_SCOPE>(
    props.filters.scope?.kind ?? EMPTY_SCOPE,
  );
  const [draftScopeId, setDraftScopeId] = useState(props.filters.scope?.id ?? "");
  const [draftLayer, setDraftLayer] = useState<GuiMemoryLatticeLayerKind | typeof EMPTY_LAYER>(
    props.filters.layer ?? EMPTY_LAYER,
  );
  const snapshot = props.response?.snapshot ?? null;
  const nodes = snapshot?.nodes ?? EMPTY_MEMORY_NODES;
  const edges = snapshot?.edges ?? EMPTY_MEMORY_EDGES;
  const unavailableReason = props.response?.unavailableReason;

  useEffect(() => {
    setDraftQuery(normalizeDraftQuery(props.filters.query ?? ""));
    setDraftScopeKind(props.filters.scope?.kind ?? EMPTY_SCOPE);
    setDraftScopeId(props.filters.scope?.id ?? "");
    setDraftLayer(props.filters.layer ?? EMPTY_LAYER);
  }, [props.filters.layer, props.filters.query, props.filters.scope?.id, props.filters.scope?.kind]);

  const selectedNode = findSelectedMemoryNode(nodes, props.selectedRecordId);

  const applyFilters = () => {
    const query = draftQuery.trim();
    const scopeId = draftScopeId.trim();
    props.onFiltersChange({
      ...(draftScopeKind !== EMPTY_SCOPE && scopeId ? { scope: { kind: draftScopeKind, id: scopeId } } : {}),
      ...(draftLayer !== EMPTY_LAYER ? { layer: draftLayer } : {}),
      ...(query ? { query } : {}),
      depth: props.filters.depth ?? 0,
      limit: props.filters.limit ?? 25,
    });
  };

  return (
    <section aria-label="Memory Lattice" className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="memory-lattice-query">Search memory</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="memory-lattice-query"
                  value={draftQuery}
                  maxLength={GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH}
                  onChange={(event) => setDraftQuery(normalizeDraftQuery(event.target.value))}
                  placeholder="topic, record, evidence"
                />
              </InputGroup>
            </Field>
            <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2">
              <Field>
                <FieldLabel>Scope kind</FieldLabel>
                <Select
                  value={draftScopeKind}
                  onValueChange={(value) => {
                    if (isDraftScopeKind(value)) {
                      setDraftScopeKind(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Scope kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value={EMPTY_SCOPE}>Any</SelectItem>
                      {GUI_MEMORY_LATTICE_SCOPE_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>{kind}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="memory-lattice-scope-id">Scope id</FieldLabel>
                <Input
                  id="memory-lattice-scope-id"
                  value={draftScopeId}
                  onChange={(event) => setDraftScopeId(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Layer</FieldLabel>
              <Select
                value={draftLayer}
                onValueChange={(value) => {
                  if (isDraftLayer(value)) {
                    setDraftLayer(value);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Layer" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value={EMPTY_LAYER}>All layers</SelectItem>
                    {GUI_MEMORY_LATTICE_LAYER_KINDS.map((layer) => (
                      <SelectItem key={layer} value={layer}>{layer}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <Button type="submit" size="sm">Apply filters</Button>
        </form>

        {props.loading ? <MemoryLatticeLoading /> : null}
        {props.error ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {props.error.message}
          </div>
        ) : null}
        {!props.loading && !props.error && nodes.length === 0 ? (
          <div className="border border-border/70 bg-background/60 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              {unavailableReason ? "Memory index unavailable" : "No memory records found."}
            </p>
            {unavailableReason ? (
              <p className="mt-1 leading-5">{unavailableReason}</p>
            ) : null}
          </div>
        ) : null}

        {nodes.length > 0 ? (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3">
            <MemoryNodeList
              nodes={nodes}
              selectedRecordId={selectedNode?.recordId ?? null}
              onSelect={props.onSelectRecord}
            />
            {selectedNode ? <MemoryNodeDetail node={selectedNode} edgeCount={edges.length} /> : null}
          </div>
        ) : null}
      </div>
      <footer className="border-t border-border/70 p-2.5">
        <div className="flex items-center gap-2">
          {props.onOpenGraph ? (
            <Button
              type="button"
              variant={props.graphOpen ? "secondary" : "default"}
              size="sm"
              className="min-w-0 flex-1"
              disabled={props.graphOpen}
              onClick={props.onOpenGraph}
            >
              <Network data-icon="inline-start" aria-hidden="true" />
              {props.graphOpen ? "Graph open" : "Open graph"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size={props.onOpenGraph ? "icon-sm" : "sm"}
            aria-label="Refresh Memory Lattice"
            className={props.onOpenGraph ? undefined : "w-full"}
            onClick={props.onRefresh}
          >
            <RefreshCw data-icon={props.onOpenGraph ? undefined : "inline-start"} aria-hidden="true" />
            {props.onOpenGraph ? null : "Refresh"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

export function MemoryLatticeSurface(props: Omit<MemoryLatticePanelProps, "filters" | "onFiltersChange">) {
  const reducedMotion = usePrefersReducedMotion();
  const snapshot = props.response?.snapshot ?? null;
  const nodes = snapshot?.nodes ?? EMPTY_MEMORY_NODES;
  const edges = snapshot?.edges ?? EMPTY_MEMORY_EDGES;
  const selectedNode = findSelectedMemoryNode(nodes, props.selectedRecordId);
  const unavailableReason = props.response?.unavailableReason;

  return (
    <section aria-label="Memory Lattice surface" className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer">
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-workspace-viewer-panel px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">Graph</h2>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {snapshot ? `${nodes.length}/${snapshot.limits.maxNodes} records` : "graph"}
          </p>
        </div>
        <Button type="button" variant="outline" size="xs" onClick={props.onRefresh}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {props.loading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-20" />
        </div>
      ) : null}
      {props.error ? (
        <div role="alert" className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          {props.error.message}
        </div>
      ) : null}
      {!props.loading && !props.error && nodes.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {unavailableReason ? "Memory index unavailable" : "No memory records found."}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {unavailableReason ?? "The Memory Lattice will render here when the project memory graph has admitted records."}
            </p>
          </div>
        </div>
      ) : null}

      {!props.loading && !props.error && nodes.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(18rem,1fr)_minmax(0,18rem)] gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] xl:grid-rows-1">
          <Suspense fallback={<MemoryGraphLoadingSurface reducedMotion={reducedMotion} />}>
            <MemoryGraphScene
              nodes={nodes}
              edges={edges}
              selectedRecordId={selectedNode?.recordId ?? null}
              reducedMotion={reducedMotion}
              onSelect={props.onSelectRecord}
            />
          </Suspense>
          <aside aria-label="Memory Lattice selection" className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {selectedNode ? <MemoryNodeDetail node={selectedNode} edgeCount={edges.length} /> : null}
            <MemoryNodeList
              nodes={nodes}
              selectedRecordId={selectedNode?.recordId ?? null}
              onSelect={props.onSelectRecord}
              ariaLabel="Memory Lattice records"
            />
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function MemoryLatticeLoading() {
  return (
    <div aria-label="Loading Memory Lattice" className="flex flex-col gap-2">
      <Skeleton className="h-32" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

function MemoryGraphLoadingSurface(props: { readonly reducedMotion: boolean }) {
  return (
    <section
      aria-label="Memory graph"
      data-reduced-motion={props.reducedMotion ? "true" : "false"}
      data-renderer="loading"
        className="relative overflow-hidden rounded-lg border border-border bg-background shadow-[inset_0_0_96px_color-mix(in_oklch,var(--color-primary)_12%,transparent)]"
    >
        <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:radial-gradient(circle_at_50%_42%,color-mix(in_oklch,var(--color-primary)_15%,transparent),transparent_52%),linear-gradient(color-mix(in_oklch,var(--color-border)_28%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklch,var(--color-border)_28%,transparent)_1px,transparent_1px)] [background-size:100%_100%,28px_28px,28px_28px]" />
      <Skeleton className="relative h-full min-h-72 w-full" />
    </section>
  );
}

function normalizeDraftQuery(value: string): string {
  return value.slice(0, GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH);
}

function isDraftScopeKind(value: string | null): value is GuiMemoryLatticeScopeKind | typeof EMPTY_SCOPE {
  return value === EMPTY_SCOPE || GUI_MEMORY_LATTICE_SCOPE_KINDS.includes(value as GuiMemoryLatticeScopeKind);
}

function isDraftLayer(value: string | null): value is GuiMemoryLatticeLayerKind | typeof EMPTY_LAYER {
  return value === EMPTY_LAYER || GUI_MEMORY_LATTICE_LAYER_KINDS.includes(value as GuiMemoryLatticeLayerKind);
}

function findSelectedMemoryNode(
  nodes: readonly GuiMemoryLatticeGraphNode[],
  selectedRecordId: string | null,
): GuiMemoryLatticeGraphNode | null {
  return selectedRecordId ? nodes.find((node) => node.recordId === selectedRecordId) ?? null : null;
}

function MemoryNodeList(props: {
  readonly nodes: readonly GuiMemoryLatticeGraphNode[];
  readonly selectedRecordId: string | null;
  readonly onSelect: (recordId: string) => void;
  readonly ariaLabel?: string;
}) {
  return (
    <section aria-label={props.ariaLabel ?? "Memory records"} className="min-h-0 rounded-lg border border-border/70">
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col">
          {props.nodes.map((node, index) => (
            <div key={node.recordId}>
              {index > 0 ? <Separator /> : null}
              <button
                type="button"
                aria-label={node.label}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  node.recordId === props.selectedRecordId
                      && "bg-status-warning-background text-foreground shadow-[inset_3px_0_0_var(--color-warning)]",
                )}
                onClick={() => props.onSelect(node.recordId)}
              >
                <span className="min-w-0 truncate">{node.label}</span>
                <Badge variant="outline" className="font-mono text-[10px]">{node.layer}</Badge>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MemoryNodeDetail(props: {
  readonly node: GuiMemoryLatticeGraphNode;
  readonly edgeCount: number;
}) {
  const lifecycleEvidence = props.node.lifecycleEvidence;

  return (
    <section aria-label="Memory record detail" className="rounded-lg border border-border/70 bg-background/70 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{props.node.label}</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{props.node.recordId}</p>
        </div>
        <Badge variant="secondary">{props.node.layer}</Badge>
      </div>
      <Separator className="my-3" />
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Scope</dt>
          <dd className="mt-1 truncate font-mono text-foreground">{props.node.scope.kind}:{props.node.scope.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Relations</dt>
          <dd className="mt-1 font-mono text-foreground">{props.edgeCount}</dd>
        </div>
      </dl>
      {lifecycleEvidence ? (
        <>
          <Separator className="my-3" />
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Latest admission</dt>
              <dd className="mt-1 font-mono text-foreground">{lifecycleEvidence.latestAdmissionDecision ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Revisions / admissions</dt>
              <dd className="mt-1 font-mono text-foreground">
                {lifecycleEvidence.revisionCount}/{lifecycleEvidence.admissionCount}
              </dd>
            </div>
          </dl>
          {lifecycleEvidence.tags.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Lifecycle tags</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {lifecycleEvidence.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            </div>
          ) : null}
          {lifecycleEvidence.relationTypes.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Relation evidence</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {lifecycleEvidence.relationTypes.map((relationType) => (
                  <Badge key={relationType} variant="secondary" className="font-mono text-[10px]">
                    {relationType}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    onChange();
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
