import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WorkbenchChromeProps {
  readonly children: ReactNode;
}

interface WorkbenchMainProps {
  readonly children: ReactNode;
}

interface InspectorRailProps {
  readonly children: ReactNode;
}

interface MobileWorkbenchDrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
}

export function WorkbenchChrome(props: WorkbenchChromeProps) {
  return (
    <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
      {props.children}
    </div>
  );
}

export function WorkbenchBody(props: WorkbenchChromeProps) {
  return (
    <div className="relative z-10 flex min-h-0 min-w-0 flex-1">
      {props.children}
    </div>
  );
}

export function WorkbenchMain(props: WorkbenchMainProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/30 bg-background">
      {props.children}
    </main>
  );
}

export function InspectorRail(props: InspectorRailProps) {
  return (
    <aside className="hidden w-[22rem] min-w-[20rem] max-w-[24rem] border-l border-border/70 bg-card xl:flex">
      {props.children}
    </aside>
  );
}

export function MobileWorkbenchDrawer(props: MobileWorkbenchDrawerProps) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/45 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          id="session-drawer"
          aria-label={props.ariaLabel}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-[min(27rem,calc(100vw-2rem))] max-w-full flex-col border-l border-border bg-card text-card-foreground shadow-[var(--shadow-elevated)] outline-none",
            "data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
          )}
        >
          <header className="flex min-h-14 items-center justify-between border-b border-border px-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="sr-only">{props.ariaLabel}</DialogPrimitive.Title>
              <p className="truncate text-sm font-semibold text-foreground">{props.title}</p>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                {props.description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              render={
                <Button type="button" variant="ghost" size="icon-sm" aria-label={props.closeLabel} />
              }
            >
              <X data-icon="inline-start" aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1">{props.children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
