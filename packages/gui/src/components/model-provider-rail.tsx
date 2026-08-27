import { LayoutGridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "./provider-glyph.js";

export interface ModelProviderOption {
  readonly id: string;
  readonly label: string;
}

export function ModelProviderRail(props: {
  readonly providers: readonly ModelProviderOption[];
  readonly selectedProviderId: string | null;
  readonly onSelectProvider: (providerId: string | null) => void;
}) {
  const options = [{ id: "__all", label: "All providers", all: true as const }, ...props.providers];
  return (
    <div role="group" aria-label="Model providers" className="no-scrollbar flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto py-2">
      {options.map((option) => {
        const selected = "all" in option ? props.selectedProviderId === null : props.selectedProviderId === option.id;
        return (
          <Tooltip key={option.id}>
            <TooltipTrigger render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={option.label}
                aria-pressed={selected}
                onClick={() => props.onSelectProvider("all" in option ? null : option.id)}
                className={cn("relative rounded-lg text-muted-foreground hover:text-foreground", selected && "bg-muted text-foreground")}
              />
            }>
              {"all" in option ? <LayoutGridIcon aria-hidden="true" /> : <ProviderGlyph providerId={option.id} />}
              {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-primary" /> : null}
            </TooltipTrigger>
            <TooltipContent side="left">{option.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
