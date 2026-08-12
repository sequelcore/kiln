import { ListFilterIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXECUTION_ROUTE_ACCESS_LABEL, EXECUTION_ROUTE_ACCESS_ORDER, type ExecutionRouteAccessFilter } from "./execution-route-picker-model.js";

export function ExecutionRouteTypeFilter({ onChange, value }: { readonly value: ExecutionRouteAccessFilter; readonly onChange: (value: ExecutionRouteAccessFilter) => void }) {
  const label = value === "all" ? "Route type" : EXECUTION_ROUTE_ACCESS_LABEL[value];
  return <Select name="execution-route-type" value={value} onValueChange={(next) => onChange(next as ExecutionRouteAccessFilter)}>
    <SelectTrigger size="sm" variant="ghost" aria-label="Route type" className="h-6 gap-1 px-2 text-xs"><ListFilterIcon aria-hidden="true" /><SelectValue>{label}</SelectValue></SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="min-w-40"><SelectItem value="all">Any route</SelectItem>{EXECUTION_ROUTE_ACCESS_ORDER.map((access) => <SelectItem key={access} value={access}>{EXECUTION_ROUTE_ACCESS_LABEL[access]}</SelectItem>)}</SelectContent>
  </Select>;
}
