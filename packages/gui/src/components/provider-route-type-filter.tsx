import { ListFilterIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROVIDER_ROUTE_ACCESS_LABEL,
  PROVIDER_ROUTE_ACCESS_ORDER,
  type ProviderRouteAccessFilter,
} from "./provider-route-picker-model.js";

interface ProviderRouteTypeFilterProps {
  readonly value: ProviderRouteAccessFilter;
  readonly onChange: (value: ProviderRouteAccessFilter) => void;
}

export function ProviderRouteTypeFilter({ onChange, value }: ProviderRouteTypeFilterProps) {
  const visibleLabel = value === "all" ? "Route type" : PROVIDER_ROUTE_ACCESS_LABEL[value];

  return (
    <Select
      name="provider-route-type"
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as ProviderRouteAccessFilter)}
    >
      <SelectTrigger
        size="sm"
        variant="ghost"
        aria-label="Route type"
        className="h-6 gap-1 px-2 text-xs"
      >
        <ListFilterIcon aria-hidden="true" />
        <SelectValue>{visibleLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="min-w-40">
        <SelectItem value="all">Any route</SelectItem>
        {PROVIDER_ROUTE_ACCESS_ORDER.map((access) => (
          <SelectItem key={access} value={access}>
            {PROVIDER_ROUTE_ACCESS_LABEL[access]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
