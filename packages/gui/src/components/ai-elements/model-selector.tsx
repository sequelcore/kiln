import type { ComponentProps, KeyboardEventHandler, ReactNode } from "react";
import { Command } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ModelSelectorProps = Omit<ComponentProps<typeof Dialog>, "children"> & {
  readonly children: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly contentClassName?: string;
  readonly finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
  readonly onContentKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

type ModelSelectorCommandProps = ComponentProps<typeof Command>;

/**
 * Kiln-owned AI Elements composition for a searchable model/provider dialog.
 * Runtime routing and authentication remain in the consuming product component.
 */
export function ModelSelector({
  children,
  contentClassName,
  description,
  finalFocus,
  onContentKeyDown,
  title,
  ...props
}: ModelSelectorProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        className={cn("max-w-2xl gap-0 overflow-hidden p-0", contentClassName)}
        finalFocus={finalFocus}
        onKeyDown={onContentKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ModelSelectorCommand({ className, ...props }: ModelSelectorCommandProps) {
  return <Command className={cn("rounded-none p-0", className)} shouldFilter={false} {...props} />;
}
