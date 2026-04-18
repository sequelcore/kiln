interface ErrorBannerProps {
  readonly message: string;
  readonly onDismiss?: () => void;
  readonly onRetry?: () => void;
}

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex w-full items-center gap-3 border-b border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-4 py-2 text-sm"
    >
      <p className="flex-1 text-[var(--color-text)]">{props.message}</p>
      {props.onRetry ? (
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded border border-[var(--color-border-active)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-background-element)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
        >
          Retry
        </button>
      ) : null}
      {props.onDismiss ? (
        <button
          type="button"
          onClick={props.onDismiss}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

