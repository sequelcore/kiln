import { AlertCircle, FileAudio, Image, LoaderCircle, X } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";

export interface PreparedComposerAttachment {
  readonly id: string;
  readonly kind: "audio" | "image";
  readonly name: string;
  readonly displayContent: string;
  readonly state: "processing" | "error" | "done";
  readonly parts?: readonly unknown[];
  readonly error?: string;
}

export function ComposerAttachments(props: {
  readonly attachments: readonly PreparedComposerAttachment[];
  readonly onRemove: (id: string) => void;
}) {
  if (props.attachments.length === 0) {
    return null;
  }

  return (
    <AttachmentGroup aria-label="Prepared attachments" className="px-2 pb-1 pt-2">
      {props.attachments.map((attachment) => (
        <Attachment
          key={attachment.id}
          state={attachment.state}
          size="sm"
          role={attachment.state === "error" ? "alert" : undefined}
        >
          <AttachmentMedia>
            {attachment.state === "processing" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : attachment.state === "error" ? (
              <AlertCircle aria-hidden="true" />
            ) : attachment.kind === "image" ? (
              <Image aria-hidden="true" />
            ) : (
              <FileAudio aria-hidden="true" />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{attachment.name}</AttachmentTitle>
            <AttachmentDescription>
              {attachment.state === "processing"
                ? "Preparing"
                : attachment.state === "error"
                  ? attachment.error
                  : attachment.kind === "image" ? "Image ready" : "Audio ready"}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => props.onRemove(attachment.id)}
            >
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}
