import { LayoutGridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "./provider-glyph.js";
import type { ProviderBrandOption } from "./provider-route-picker-model.js";

interface ProviderBrandRailProps {
  readonly brands: readonly ProviderBrandOption[];
  readonly selectedBrandId: string | null;
  readonly onSelectBrand: (brandId: string | null) => void;
}

export function ProviderBrandRail({ brands, onSelectBrand, selectedBrandId }: ProviderBrandRailProps) {
  const options: readonly (ProviderBrandOption & { readonly all?: true })[] = [
    { id: "all", label: "All providers", all: true },
    ...brands,
  ];

  return (
    <div role="group" aria-label="Providers" className="no-scrollbar flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto py-2">
      {options.map((option) => {
        const selected = option.all ? selectedBrandId === null : selectedBrandId === option.id;
        return (
          <Tooltip key={option.id}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={option.label}
                  aria-pressed={selected}
                  onClick={() => onSelectBrand(option.all ? null : option.id)}
                  className={cn(
                    "relative rounded-lg text-muted-foreground hover:text-foreground",
                    selected && "bg-muted text-foreground",
                  )}
                />
              }
            >
              {option.all ? <LayoutGridIcon aria-hidden="true" /> : <ProviderGlyph providerId={option.id} />}
              {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-primary" /> : null}
            </TooltipTrigger>
            <TooltipContent side="left">{option.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
