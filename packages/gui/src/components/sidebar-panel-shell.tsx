import type { ReactNode } from "react";

interface SidebarPanelShellProps {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function SidebarPanelShell(props: SidebarPanelShellProps) {
  return (
    <aside
      aria-label={props.title}
      className="flex h-full min-h-0 flex-col border-r border-border/70 bg-card"
    >
      <header className="flex min-h-12 items-center gap-2 border-b border-border/70 px-3.5 py-3">
        <p className="text-sm font-semibold tracking-tight text-foreground">{props.title}</p>
        {props.meta ? (
          <p className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {props.meta}
          </p>
        ) : null}
      </header>

      {props.children}

      {props.footer ? <footer className="border-t border-border/70 p-2.5">{props.footer}</footer> : null}
    </aside>
  );
}
