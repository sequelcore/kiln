import type { ReactNode } from "react";

interface InspectorPanelShellProps {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function InspectorPanelShell(props: InspectorPanelShellProps) {
  return (
    <aside
      aria-label={props.title}
      className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border/70 bg-card"
    >
      <header className="flex min-h-12 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-foreground">{props.title}</p>
        {props.meta ? (
          <p className="ml-auto shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
            {props.meta}
          </p>
        ) : null}
      </header>

      {props.children}

      {props.footer ? <footer className="border-t border-border/60 p-2.5">{props.footer}</footer> : null}
    </aside>
  );
}

export function InspectorEmptyState(props: {
  readonly label: string;
  readonly description: string;
}) {
  return (
    <div className="grid h-full place-items-center px-5 py-12 text-center">
      <div className="max-w-64">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">{props.label}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.description}</p>
      </div>
    </div>
  );
}

export function InspectorDetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/65 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{props.label}</p>
      <p className="mt-1 break-words text-sm leading-5 text-foreground">{props.value}</p>
    </div>
  );
}
