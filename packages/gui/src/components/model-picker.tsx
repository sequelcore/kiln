import {
  filterModelCatalogItems,
  getGuiProviderMetadata,
  modelCatalogPrimaryAction,
  projectModelCatalogItems,
  type ExecutionTargetRepairAction,
  type ModelCatalog,
  type ModelCatalogAccessFilter,
  type ModelCatalogEntry,
  type ModelCatalogItem,
} from "@kilnai/gateway-contracts";
import { CheckIcon, CircleAlertIcon, Settings2Icon, WrenchIcon } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ModelSelectorCommand } from "@/components/ai-elements/model-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ModelAccessFilter } from "./model-access-filter.js";
import { ModelProviderRail, type ModelProviderOption } from "./model-provider-rail.js";
import { ProviderGlyph } from "./provider-glyph.js";

export interface ModelPickerRepairRequest {
  readonly targetId: string;
  readonly providerId: string;
  readonly action: ExecutionTargetRepairAction;
}

export type ModelSelectionStatus =
  | { readonly state: "idle" }
  | { readonly state: "selecting"; readonly targetId: string }
  | { readonly state: "failed"; readonly message: string };

export type ModelCatalogRefreshStatus =
  | { readonly state: "idle" }
  | { readonly state: "refreshing" }
  | { readonly state: "failed"; readonly message: string };

type PickerState = {
  readonly query: string;
  readonly providerId: string | null;
  readonly access: ModelCatalogAccessFilter;
};
type PickerAction =
  | { readonly type: "query"; readonly query: string }
  | { readonly type: "provider"; readonly providerId: string | null }
  | { readonly type: "access"; readonly access: ModelCatalogAccessFilter };

function reducer(state: PickerState, action: PickerAction): PickerState {
  if (action.type === "query") return { ...state, query: action.query, ...(action.query.trim() ? { providerId: null } : {}) };
  if (action.type === "provider") return { ...state, providerId: action.providerId, query: "" };
  return { ...state, access: action.access };
}

export function ModelPicker(props: {
  readonly catalog: ModelCatalog;
  readonly activeTargetId?: string | null;
  readonly activeAccountOverrideId?: string | null;
  readonly selectionStatus?: ModelSelectionStatus;
  readonly refreshStatus?: ModelCatalogRefreshStatus;
  readonly onSelect: (selection: { targetId: string; accountOverrideId?: string }) => void;
  readonly onRepair: (request: ModelPickerRepairRequest) => void | Promise<void>;
  readonly onConfigure: (model: ModelCatalogEntry) => void | Promise<void>;
}) {
  const items = useMemo(() => projectModelCatalogItems(props.catalog), [props.catalog]);
  const [state, dispatch] = useReducer(reducer, { query: "", providerId: null, access: "all" });
  const filtered = useMemo(() => filterModelCatalogItems(items, state), [items, state]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const preview = filtered.find((item) => item.key === previewKey) ?? filtered[0] ?? null;
  useEffect(() => {
    if (previewKey && !filtered.some((item) => item.key === previewKey)) setPreviewKey(filtered[0]?.key ?? null);
  }, [filtered, previewKey]);
  const providers = useMemo(() => providerOptions(items), [items]);
  const pending = props.selectionStatus?.state === "selecting" || props.refreshStatus?.state === "refreshing";

  return (
    <ModelSelectorCommand id="model-picker" label="Search models" shouldFilter={false}>
      <CommandInput aria-label="Search models" placeholder="Search by model, provider, or family…" value={state.query} onValueChange={(query) => dispatch({ type: "query", query })} />
      <div className="flex min-h-0 border-t border-border/70">
        <ModelProviderRail providers={providers} selectedProviderId={state.providerId} onSelectProvider={(providerId) => dispatch({ type: "provider", providerId })} />
        <div className="grid min-h-[26rem] min-w-0 flex-1 grid-cols-1 border-l border-border/70 md:grid-cols-[minmax(16rem,0.9fr)_minmax(19rem,1.1fr)]">
          <div className="flex min-h-0 min-w-0 flex-col border-b border-border/70 md:border-r md:border-b-0">
            <div className="flex h-10 items-center border-b border-border/70 px-1.5">
              <ModelAccessFilter value={state.access} onChange={(access) => dispatch({ type: "access", access })} />
              <span className="ml-auto px-2 text-xs text-muted-foreground">{filtered.length} models</span>
            </div>
            <PickerStatus selection={props.selectionStatus} refresh={props.refreshStatus} />
            <CommandList label="Models" className="max-h-[18rem] flex-1 p-1.5 md:max-h-[29rem]">
              <CommandEmpty>No models match these filters.</CommandEmpty>
              <CommandGroup aria-label="Models" className="p-0">
                {filtered.map((item) => (
                  <ModelRow
                    key={item.key}
                    item={item}
                    active={item.targets.some((target) => target.targetId === props.activeTargetId)}
                    previewed={item.key === preview?.key}
                    onPreview={() => setPreviewKey(item.key)}
                  />
                ))}
              </CommandGroup>
            </CommandList>
          </div>
          <ModelDetail
            item={preview}
            activeTargetId={props.activeTargetId}
            activeAccountOverrideId={props.activeAccountOverrideId}
            pending={pending}
            onSelect={props.onSelect}
            onRepair={props.onRepair}
            onConfigure={props.onConfigure}
          />
        </div>
      </div>
    </ModelSelectorCommand>
  );
}

function ModelRow(props: { readonly item: ModelCatalogItem; readonly active: boolean; readonly previewed: boolean; readonly onPreview: () => void }) {
  return (
    <CommandItem
      value={props.item.key}
      aria-label={`${props.item.label}, ${props.item.providerId}${props.active ? ", current" : ""}`}
      data-checked={props.previewed || undefined}
      onSelect={props.onPreview}
      className="items-start rounded-lg px-2.5 py-2.5"
    >
      <ProviderGlyph providerId={props.item.providerId} className="mt-0.5 size-5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{props.item.label}</span>
          {props.active ? <span className="text-xs text-primary">Current</span> : null}
          {!props.item.configured ? <Badge variant="outline">Setup</Badge> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{props.item.providerId} · {props.item.family}</span>
      </span>
      <span className={cn("mt-1 size-2 rounded-full", props.item.availability === "available" ? "bg-success" : props.item.availability === "unavailable" ? "bg-error" : "bg-muted-foreground/50")} aria-hidden="true" />
    </CommandItem>
  );
}

function PickerStatus(props: { readonly selection?: ModelSelectionStatus; readonly refresh?: ModelCatalogRefreshStatus }) {
  const message = props.selection?.state === "failed" ? props.selection.message
    : props.refresh?.state === "failed" ? `Model refresh failed: ${props.refresh.message}`
      : props.selection?.state === "selecting" ? "Applying execution target…"
        : props.refresh?.state === "refreshing" ? "Refreshing model catalog…" : null;
  if (!message) return null;
  const failed = props.selection?.state === "failed" || props.refresh?.state === "failed";
  return <div role={failed ? "alert" : "status"} aria-live="polite" className={cn("border-b px-3 py-2 text-xs", failed ? "border-destructive/30 text-destructive" : "border-border/70 text-muted-foreground")}>{message}</div>;
}

function ModelDetail(props: {
  readonly item: ModelCatalogItem | null;
  readonly activeTargetId?: string | null;
  readonly activeAccountOverrideId?: string | null;
  readonly pending: boolean;
  readonly onSelect: (selection: { targetId: string; accountOverrideId?: string }) => void;
  readonly onRepair: (request: ModelPickerRepairRequest) => void | Promise<void>;
  readonly onConfigure: (model: ModelCatalogEntry) => void | Promise<void>;
}) {
  const [targetId, setTargetId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const item = props.item;
  const availableTargets = item?.targets.filter((target) => target.availability === "available") ?? [];
  const selectedTarget = item?.targets.find((target) => target.targetId === targetId)
    ?? availableTargets[0]
    ?? item?.targets[0];
  const isCurrentSelection = selectedTarget?.targetId === props.activeTargetId
    && (accountId || null) === (props.activeAccountOverrideId ?? null);
  useEffect(() => {
    setTargetId(availableTargets[0]?.targetId ?? item?.targets[0]?.targetId ?? "");
    setAccountId("");
  }, [item?.key]);
  if (!item) return <div className="grid min-h-52 place-items-center p-6 text-sm text-muted-foreground">Select a model to inspect it.</div>;
  const action = modelCatalogPrimaryAction(item.model);
  const capabilities = item.model.capabilities;
  return (
    <section aria-label={`${item.label} details`} className="min-w-0 overflow-y-auto p-5">
      <div className="flex items-start gap-3">
        <ProviderGlyph providerId={item.providerId} className="mt-0.5 size-8" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold tracking-[-0.02em]">{item.label}</h3>
          <p className="truncate text-sm text-muted-foreground">{getGuiProviderMetadata(item.providerId)?.label ?? item.providerId} · {item.providerModelId}</p>
        </div>
        {item.model.lifecycle === "deprecated" ? <Badge variant="destructive">Deprecated</Badge> : null}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
        <Fact label="Access" value={item.access} />
        <Fact label="Released" value={item.model.releaseDate ?? "Unknown"} />
        <Fact label="Context" value={formatTokens(capabilities?.contextWindow)} />
        <Fact label="Max output" value={formatTokens(capabilities?.maxOutputTokens)} />
      </dl>

      <div className="mt-5">
        <p className="text-xs font-medium text-muted-foreground">Accepts</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{(capabilities?.inputModalities ?? ["text"]).map((value) => <Badge key={value} variant="secondary">{value}</Badge>)}</div>
      </div>
      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Capabilities</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {capabilities?.tools ? <Badge variant="secondary">Tool calling</Badge> : null}
          {capabilities?.structuredOutput ? <Badge variant="secondary">Structured output</Badge> : null}
          {capabilities?.reasoning ? <Badge variant="secondary">Reasoning</Badge> : null}
          {!capabilities ? <span className="text-sm text-muted-foreground">No capability metadata yet.</span> : null}
        </div>
      </div>

      {item.targets.length > 1 ? (
        <div className="mt-5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="model-target-variant">Execution target</label>
          <Select value={selectedTarget?.targetId ?? ""} onValueChange={(value) => { if (value) setTargetId(value); setAccountId(""); }}>
            <SelectTrigger id="model-target-variant" className="mt-2 w-full"><SelectValue>{selectedTarget?.label ?? "Choose target"}</SelectValue></SelectTrigger>
            <SelectContent>{item.targets.map((target) => <SelectItem key={target.targetId} value={target.targetId} disabled={target.availability !== "available"}>{target.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}

      {selectedTarget && selectedTarget.accountOverrideIds.length > 1 ? (
        <div className="mt-4">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="model-account-override">Account preference</label>
          <Select value={accountId || "__automatic__"} onValueChange={(value) => setAccountId(value === "__automatic__" || value === null ? "" : value)}>
            <SelectTrigger id="model-account-override" className="mt-2 w-full"><SelectValue>{accountId || "Kiln chooses"}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="__automatic__">Kiln chooses</SelectItem>
              {selectedTarget.accountOverrideIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-6 border-t border-border/70 pt-4">
        {action.kind === "configure" ? (
          <Button className="w-full" disabled={props.pending} onClick={() => void props.onConfigure(item.model)}><Settings2Icon />Configure this model</Button>
        ) : selectedTarget?.availability === "available" ? (
          <Button className="w-full" disabled={props.pending || isCurrentSelection} onClick={() => props.onSelect({ targetId: selectedTarget.targetId, ...(accountId ? { accountOverrideId: accountId } : {}) })}>
            {isCurrentSelection ? <CheckIcon /> : null}
            {isCurrentSelection ? "Current model" : `Use ${item.label}`}
          </Button>
        ) : selectedTarget ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-muted-foreground"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" /><span>{humanizeReason(selectedTarget.reasonCodes[0] ?? "target unavailable")}</span></div>
            {selectedTarget.repairActions.map((repair) => <Button key={repair} variant="outline" className="w-full" disabled={props.pending} onClick={() => void props.onRepair({ targetId: selectedTarget.targetId, providerId: item.providerId, action: repair })}><WrenchIcon />{repairLabel(repair, item.providerId)}</Button>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Fact(props: { readonly label: string; readonly value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{props.label}</dt><dd className="mt-0.5 font-medium">{props.value}</dd></div>;
}

function providerOptions(items: readonly ModelCatalogItem[]): readonly ModelProviderOption[] {
  return [...new Set(items.map((item) => item.providerId))].map((id) => ({ id, label: getGuiProviderMetadata(id)?.label ?? id }));
}

function formatTokens(value: number | undefined): string {
  if (!value) return "Unknown";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(0))}K`;
  return String(value);
}

function humanizeReason(value: string): string {
  const text = value.replaceAll("-", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function repairLabel(action: ExecutionTargetRepairAction, providerId: string): string {
  if (action === "authenticate-provider") return `Authenticate ${providerId}`;
  if (action === "refresh-model-catalog") return "Refresh model catalog";
  if (action === "retry-target") return "Retry target";
  if (action === "review-target-configuration") return "Review target configuration";
  if (action === "select-another-model") return "Select another model";
  if (action === "check-provider") return "Check provider";
  return "Check account";
}
