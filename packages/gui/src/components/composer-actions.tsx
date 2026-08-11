import { useState, type ChangeEvent, type ReactElement, type RefObject } from "react";
import { ArrowUp, FileAudio, Image, Mic, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type VoiceState = "idle" | "requesting" | "recording" | "encoding";

function ComposerTooltip(props: { readonly label: string; readonly children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

interface ComposerAttachmentActionProps {
  readonly fileButtonDisabled: boolean;
  readonly imageButtonDisabled: boolean;
  readonly audioFileInputRef: RefObject<HTMLInputElement | null>;
  readonly imageFileInputRef: RefObject<HTMLInputElement | null>;
  readonly onAudioFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

interface ComposerTrailingActionsProps {
  readonly canSubmit: boolean;
  readonly turnActive?: boolean;
  readonly cancelPending?: boolean;
  readonly voiceButtonDisabled: boolean;
  readonly voiceState: VoiceState;
  readonly onToggleVoiceCapture: () => void;
  readonly onCancel?: () => void;
}

export function ComposerAttachmentAction(props: ComposerAttachmentActionProps) {
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);

  return (
    <div className="flex min-w-0 items-center">
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
      <Popover open={attachmentMenuOpen} onOpenChange={setAttachmentMenuOpen}>
        <PopoverTrigger
          render={
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={props.fileButtonDisabled && props.imageButtonDisabled}
              aria-label="Add attachment"
              title="Add attachment"
              className="shrink-0"
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
            </InputGroupButton>
          }
        />
        <PopoverContent align="start" side="top" sideOffset={8} className="w-52 gap-1 p-1">
          <Button
            type="button"
            variant="ghost"
            disabled={props.fileButtonDisabled}
            aria-label="Attach audio file"
            className="w-full justify-start"
            onClick={() => {
              setAttachmentMenuOpen(false);
              props.audioFileInputRef.current?.click();
            }}
          >
            <FileAudio data-icon="inline-start" aria-hidden="true" />
            Audio file
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={props.imageButtonDisabled}
            aria-label="Attach image"
            className="w-full justify-start"
            onClick={() => {
              setAttachmentMenuOpen(false);
              props.imageFileInputRef.current?.click();
            }}
          >
            <Image data-icon="inline-start" aria-hidden="true" />
            Image
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ComposerTrailingActions(props: ComposerTrailingActionsProps) {
  const recording = props.voiceState === "recording";
  const voiceLabel = recording
    ? "Stop voice recording"
    : props.voiceState === "requesting"
      ? "Requesting microphone access"
      : "Record voice";

  return (
    <TooltipProvider delay={300}>
      <div className="flex min-w-0 items-center gap-1">
        <ComposerTooltip label={voiceLabel}>
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant={recording ? "secondary" : "ghost"}
            disabled={props.voiceButtonDisabled}
            aria-pressed={recording}
            aria-label={voiceLabel}
            onClick={props.onToggleVoiceCapture}
          >
            {recording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </InputGroupButton>
        </ComposerTooltip>
        {props.turnActive ? (
          <ComposerTooltip label={props.cancelPending ? "Cancelling response" : "Stop response"}>
            <Button
              type="button"
              disabled={props.cancelPending}
              variant="destructive"
              size="icon"
              aria-label={props.cancelPending ? "Cancelling response" : "Stop response"}
              className="rounded-full"
              onClick={props.onCancel}
            >
              <Square aria-hidden="true" />
            </Button>
          </ComposerTooltip>
        ) : (
          <Button
            type="submit"
            disabled={!props.canSubmit}
            variant="default"
            size="icon"
            aria-label="Send message"
            className="rounded-full"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}
