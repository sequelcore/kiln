import { LayoutGridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "./provider-glyph.js";
import type { ExecutionRouteBrandOption } from "./execution-route-picker-model.js";

export function ExecutionRouteBrandRail(props: {
  readonly brands: readonly ExecutionRouteBrandOption[];
  readonly selectedBrandId: string | null;
  readonly onSelectBrand: (brandId: string | null) => void;
}) {
  const allProvidersId = "__kiln-all-providers";
  const options: readonly (ExecutionRouteBrandOption & { readonly all?: true })[] = [
    { id: allProvidersId, label: "All providers", all: true },
    ...props.brands,
  ];
  return <div role="group" aria-label="Providers" className="no-scrollbar flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto py-2">
    {options.map((option) => {
      const selected = option.all ? props.selectedBrandId === null : props.selectedBrandId === option.id;
      return <Tooltip key={option.id}><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-lg" aria-label={option.label} aria-pressed={selected} onClick={() => props.onSelectBrand(option.all ? null : option.id)} className={cn("relative rounded-lg text-muted-foreground hover:text-foreground", selected && "bg-muted text-foreground")} />}>
        {option.all ? <LayoutGridIcon aria-hidden="true" /> : <ProviderGlyph providerId={option.id} />}
        {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-primary" /> : null}
      </TooltipTrigger><TooltipContent side="left">{option.label}</TooltipContent></Tooltip>;
    })}
  </div>;
}
