import { ListFilterIcon } from "lucide-react";
import type { ModelCatalogAccessFilter } from "@kilnai/gateway-contracts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACCESS_LABEL = {
  subscription: "Subscription",
  harness: "Harness",
  api: "API",
  local: "Local",
} as const;

export function ModelAccessFilter(props: {
  readonly value: ModelCatalogAccessFilter;
  readonly onChange: (value: ModelCatalogAccessFilter) => void;
}) {
  const label = props.value === "all" ? "Access" : ACCESS_LABEL[props.value];
  return (
    <Select name="model-access" value={props.value} onValueChange={(value) => props.onChange(value as ModelCatalogAccessFilter)}>
      <SelectTrigger size="sm" variant="ghost" aria-label="Model access" className="h-7 gap-1 px-2 text-xs">
        <ListFilterIcon aria-hidden="true" />
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="min-w-40">
        <SelectItem value="all">Any access</SelectItem>
        {Object.entries(ACCESS_LABEL).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
