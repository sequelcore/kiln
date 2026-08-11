import type { ComponentProps, KeyboardEventHandler, ReactNode } from "react";
import { Command } from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ModelSelectorProps = Omit<ComponentProps<typeof Popover>, "children"> & {
  readonly children: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly contentClassName?: string;
  readonly anchor?: ComponentProps<typeof PopoverContent>["anchor"];
  readonly finalFocus?: ComponentProps<typeof PopoverContent>["finalFocus"];
  readonly onContentKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

type ModelSelectorCommandProps = ComponentProps<typeof Command>;

/**
 * Kiln-owned AI Elements composition for a searchable model/provider popover.
 * Runtime routing and authentication remain in the consuming product component.
 */
export function ModelSelector({
  children,
  anchor,
  contentClassName,
  description,
  finalFocus,
  onContentKeyDown,
  title,
  ...props
}: ModelSelectorProps) {
  return (
    <Popover modal={false} {...props}>
      <PopoverContent
        anchor={anchor}
        side="top"
        align="start"
        sideOffset={8}
        className={cn(
          "w-[min(32rem,calc(100vw-1rem))] max-w-none gap-0 overflow-hidden rounded-xl p-0",
          contentClassName,
        )}
        finalFocus={finalFocus}
        onKeyDown={onContentKeyDown}
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function ModelSelectorCommand({ className, ...props }: ModelSelectorCommandProps) {
  return <Command className={cn("rounded-none p-0", className)} shouldFilter={false} {...props} />;
}
