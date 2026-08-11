import { useId } from "react";
import { Circle, CircleAlert, Info, TriangleAlert, Waypoints } from "lucide-react";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { cn } from "@/lib/utils";

function ContinuityIcon(props: { readonly tone: ComposerContinuityHint["tone"] }) {
  switch (props.tone) {
    case "warning": return <TriangleAlert />;
    case "danger": return <CircleAlert />;
    case "info": return <Info />;
    case "accent": return <Waypoints />;
    case "muted": return <Circle />;
  }
}

function continuityToneClass(tone: ComposerContinuityHint["tone"]): string {
  switch (tone) {
    case "warning": return "text-warning";
    case "danger": return "text-destructive";
    case "info": return "text-info";
    case "accent": return "text-primary";
    case "muted": return "text-muted-foreground";
  }
}

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
      className={cn("w-auto min-w-0 shrink-0 px-1.5", continuityToneClass(props.hint.tone))}
      data-tone={props.hint.tone}
    >
      <MarkerIcon><ContinuityIcon tone={props.hint.tone} /></MarkerIcon>
      <MarkerContent className="truncate">{props.hint.label}</MarkerContent>
      <span id={descriptionId} className="sr-only">{props.hint.description}</span>
    </Marker>
  );
}
