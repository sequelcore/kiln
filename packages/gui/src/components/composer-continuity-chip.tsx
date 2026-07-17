import { useId } from "react";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import { Marker, MarkerContent } from "@/components/ui/marker";

export function ComposerContinuityChip(props: {
  readonly hint: ComposerContinuityHint;
}) {
  const descriptionId = useId();
  if (props.hint.prominence === "routine") return null;

  return (
    <Marker
      role="status"
      aria-label="Session continuity"
      aria-describedby={descriptionId}
      className="w-auto min-w-0 shrink-0 px-1.5"
    >
      <MarkerContent className="truncate">{props.hint.label}</MarkerContent>
      <span id={descriptionId} className="sr-only">{props.hint.description}</span>
    </Marker>
  );
}
