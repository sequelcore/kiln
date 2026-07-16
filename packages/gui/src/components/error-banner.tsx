import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBannerProps {
  readonly message: string;
  readonly onDismiss?: () => void;
  readonly onRetry?: () => void;
}

interface ErrorBannerPresentation {
  readonly title: string;
  readonly detail: string;
  readonly technicalDetail?: string;
}

function formatErrorBannerMessage(message: string): ErrorBannerPresentation {
  if (message.includes("unsupported_modality") && message.includes("required=audio")) {
    return {
      title: "Audio is not available on this route",
      detail: "The selected provider and model cannot accept audio input, and no governed transform route is available for this turn. Use text input, switch to an audio-capable route, or enable a voice transform provider.",
      technicalDetail: message,
    };
  }

  return {
    title: "Operation failed",
    detail: message,
  };
}

export function ErrorBanner(props: ErrorBannerProps) {
  const presentation = formatErrorBannerMessage(props.message);

  return (
    <div
      role="alert"
      aria-label={presentation.title}
      className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-status-danger-border bg-status-danger-background px-3 py-3 text-sm shadow-[var(--shadow-elevated)]"
    >
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-status-danger-border bg-background-panel text-error">
        <AlertTriangle className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-text)]">{presentation.title}</p>
        <p className="mt-1 break-words text-xs leading-5 text-[var(--color-text-muted)]">
          {presentation.detail}
        </p>
        {presentation.technicalDetail ? (
          <details className="mt-2 text-xs text-[var(--color-text-muted)]">
            <summary className="cursor-pointer select-none text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Diagnostics
            </summary>
            <code className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 font-mono text-[11px] leading-4">
              {presentation.technicalDetail}
            </code>
          </details>
        ) : null}
      </div>
      {props.onRetry ? (
        <Button
          type="button"
          onClick={props.onRetry}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
      {props.onDismiss ? (
        <Button
          type="button"
          onClick={props.onDismiss}
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          title="Dismiss"
          className="shrink-0 text-[var(--color-text-muted)]"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
