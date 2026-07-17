import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type TranscriptSurfaceKind = "approval" | "event" | "message" | "tool" | "workflow";

export type TranscriptSurfaceProps = ComponentProps<"article"> & {
  readonly kind: TranscriptSurfaceKind;
};

export function TranscriptSurface({ className, kind, ...props }: TranscriptSurfaceProps) {
  return (
    <article
      {...props}
      className={cn("mx-auto w-full min-w-0 max-w-3xl", className)}
      data-slot="transcript-surface"
      data-surface-kind={kind}
    />
  );
}
