import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GuiErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onReload?: () => void;
}

interface GuiErrorBoundaryState {
  readonly error: Error | null;
}

export class GuiErrorBoundary extends Component<GuiErrorBoundaryProps, GuiErrorBoundaryState> {
  override state: GuiErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): GuiErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Kiln GUI render failure", error, errorInfo);
  }

  private readonly reload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }

    window.location.reload();
  };

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--color-background)] px-6 text-[var(--color-text)]">
        <section
          role="alert"
          aria-label="Kiln GUI failed to render"
          className="w-full max-w-xl rounded-lg border border-[var(--color-error)]/45 bg-[var(--color-background-panel)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
        >
          <div className="flex items-start gap-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold">Kiln GUI failed to render</h1>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                The interface hit a render-time failure. Reload the GUI to start a clean surface.
              </p>
              <code className="mt-3 block max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                {this.state.error.message}
              </code>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={this.reload}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Reload GUI
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
