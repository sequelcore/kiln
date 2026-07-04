import type { ChangeEvent, ReactElement, RefObject } from "react";
import { ArrowUp, Image, ListChecks, Mic, Paperclip, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type VoiceState = "idle" | "recording" | "encoding";

function ComposerTooltip(props: {
  readonly label: string;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

interface ComposerActionProps {
  readonly planMode: boolean;
  readonly canSubmit: boolean;
  readonly fileButtonDisabled: boolean;
  readonly imageButtonDisabled: boolean;
  readonly voiceButtonDisabled: boolean;
  readonly voiceState: VoiceState;
  readonly audioFileInputRef: RefObject<HTMLInputElement | null>;
  readonly imageFileInputRef: RefObject<HTMLInputElement | null>;
  readonly onTogglePlanMode: () => void;
  readonly onToggleVoiceCapture: () => void;
  readonly onAudioFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function ComposerLeadingActions(props: ComposerActionProps) {
  return (
    <TooltipProvider delay={300}>
      <div className="flex min-w-0 items-center gap-1">
        <input
          ref={props.audioFileInputRef}
          type="file"
          accept="audio/*"
          aria-label="Audio file input"
          className="sr-only"
          disabled={props.fileButtonDisabled}
          onChange={props.onAudioFileChange}
        />
        <input
          ref={props.imageFileInputRef}
          type="file"
          accept="image/*"
          aria-label="Image file input"
          className="sr-only"
          disabled={props.imageButtonDisabled}
          onChange={props.onImageFileChange}
        />
        <ComposerTooltip label="Attach audio file">
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={props.fileButtonDisabled}
            aria-label="Attach audio file"
            className="bg-background/60 text-muted-foreground"
            onClick={() => props.audioFileInputRef.current?.click()}
          >
            <Paperclip aria-hidden="true" />
          </InputGroupButton>
        </ComposerTooltip>
        <ComposerTooltip label="Attach image">
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={props.imageButtonDisabled}
            aria-label="Attach image"
            className="bg-background/60 text-muted-foreground"
            onClick={() => props.imageFileInputRef.current?.click()}
          >
            <Image aria-hidden="true" />
          </InputGroupButton>
        </ComposerTooltip>
        <ComposerTooltip label="Plan mode">
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant={props.planMode ? "secondary" : "outline"}
            aria-pressed={props.planMode}
            aria-label="Plan"
            className={props.planMode ? undefined : "bg-background/60 text-muted-foreground"}
            onClick={props.onTogglePlanMode}
          >
            <ListChecks aria-hidden="true" />
          </InputGroupButton>
        </ComposerTooltip>
      </div>
    </TooltipProvider>
  );
}

export function ComposerTrailingActions(props: ComposerActionProps) {
  const recording = props.voiceState === "recording";
  const voiceLabel = recording ? "Stop voice recording" : "Record voice";

  return (
    <TooltipProvider delay={300}>
      <div className="flex min-w-0 items-center gap-1">
        <ComposerTooltip label={voiceLabel}>
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant={recording ? "secondary" : "outline"}
            disabled={props.voiceButtonDisabled}
            aria-pressed={recording}
            aria-label={voiceLabel}
            className={recording ? undefined : "bg-background/60 text-muted-foreground"}
            onClick={props.onToggleVoiceCapture}
          >
            {recording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </InputGroupButton>
        </ComposerTooltip>
        <Button
          type="submit"
          disabled={!props.canSubmit}
          variant="default"
          size="icon-sm"
          aria-label="Send message"
          className="rounded-lg"
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
    </TooltipProvider>
  );
}
