import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ActivityPhase, SessionStatus } from "../lib/session-store/index.js";
import type { ContextUsageProjection, WorkflowGoalActivity } from "@kilnai/gateway-contracts";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import { ComposerLeadingActions, ComposerTrailingActions } from "./composer-actions.js";
import { ComposerFrame, type ComposerCommandMenuState } from "./composer-frame.js";
import { ActiveGoalDock } from "./active-goal-dock.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ComposerAttachments,
} from "./composer-attachments.js";
import { useComposerMedia } from "./use-composer-media.js";

export interface ComposerSubmission {
  readonly text: string;
  readonly parts?: readonly unknown[];
  readonly displayContent?: string;
}

interface ComposerProps {
  readonly status: SessionStatus;
  readonly activityPhase?: ActivityPhase;
  readonly activityToolName?: string;
  readonly activityDetails?: string;
  readonly planMode: boolean;
  readonly governedWorkItemCount: number | null;
  readonly continuityHint: ComposerContinuityHint;
  readonly contextUsage?: ContextUsageProjection | null;
  readonly foregroundGoal?: WorkflowGoalActivity;
  readonly onGoalControl?: (input: {
    readonly goalRunId: string;
    readonly action: "pause" | "resume" | "update_objective" | "cancel";
    readonly objective?: string;
    readonly reason?: string;
  }) => boolean;
  readonly pendingGoalAction?: "pause" | "resume" | "update_objective" | "cancel";
  readonly providerControl?: ReactNode;
  readonly deliberationControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly onSubmit: (submission: ComposerSubmission) => boolean;
  readonly onCancel: () => void;
  readonly cancelPending?: boolean;
  readonly onTogglePlanMode: (enabled: boolean) => void;
  readonly onGovernedWorkItemCountChange: (count: number | null) => void;
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const isBusy = props.status === "running" || props.status === "connecting";
  const {
    attachments,
    audioFileInputRef,
    composerError,
    fileButtonDisabled,
    handleAudioFileChange,
    handleImageFileChange,
    handlePaste,
    hasAttachmentError,
    imageButtonDisabled,
    imageFileInputRef,
    isPreparingAttachment,
    removeAttachment,
    resetPreparedMedia,
    toggleVoiceCapture,
    voiceButtonDisabled,
    voiceState,
  } = useComposerMedia({
    isBusy,
    onPasteText: (text, selectionStart, selectionEnd) => {
      setDraft((current) => `${current.slice(0, selectionStart)}${text}${current.slice(selectionEnd)}`);
    },
  });
  const hasReadyAttachment = attachments.some((attachment) => attachment.state === "done");
  const canSubmit = props.status === "ready"
    && !isPreparingAttachment
    && !hasAttachmentError
    && (draft.trim().length > 0 || hasReadyAttachment);
  const activity = props.activityPhase && props.activityPhase !== "idle"
    ? {
        phase: props.activityPhase,
        ...(props.activityToolName ? { toolName: props.activityToolName } : {}),
        ...(props.activityDetails ? { details: props.activityDetails } : {}),
      }
    : undefined;
  const foregroundGoal = props.foregroundGoal;

  function handleDraftChange(value: string): void {
    if (value.trim() === "/") {
      setDraft("");
      props.commandMenu.onOpenChange(true);
      return;
    }
    setDraft(value);
  }

  function submitDraft(): void {
    if (!canSubmit) {
      return;
    }
    const readyAttachments = attachments.filter((attachment) => attachment.state === "done" && attachment.parts);
    const parts = readyAttachments.flatMap((attachment) => attachment.parts ?? []);
    const text = draft.trim();
    const displayContent = [text, ...readyAttachments.map((attachment) => attachment.displayContent)]
      .filter(Boolean)
      .join("\n");
    const accepted = props.onSubmit({
      text,
      ...(parts.length > 0 ? { parts, displayContent } : {}),
    });
    if (!accepted) {
      return;
    }
    setDraft("");
    resetPreparedMedia();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === "/"
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && draft.trim().length === 0
    ) {
      event.preventDefault();
      props.commandMenu.onOpenChange(true);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitDraft();
  }

  return (
    <ComposerFrame
      draft={draft}
      continuityHint={props.continuityHint}
      contextUsage={props.contextUsage}
      status={props.status}
      activity={activity}
      activeGoal={foregroundGoal ? (
        <ActiveGoalDock
          activity={foregroundGoal}
          pendingAction={props.pendingGoalAction === "update_objective" ? "edit" : props.pendingGoalAction}
          onPause={props.onGoalControl ? () => props.onGoalControl?.({
            goalRunId: foregroundGoal.goal.id,
            action: "pause",
          }) : undefined}
          onResume={props.onGoalControl ? () => props.onGoalControl?.({
            goalRunId: foregroundGoal.goal.id,
            action: "resume",
          }) : undefined}
          onUpdateObjective={props.onGoalControl ? (objective) => props.onGoalControl?.({
            goalRunId: foregroundGoal.goal.id,
            action: "update_objective",
            objective,
          }) ?? false : undefined}
          onCancel={props.onGoalControl ? () => props.onGoalControl?.({
            goalRunId: foregroundGoal.goal.id,
            action: "cancel",
            reason: "Operator cancelled the goal from the active goal dock.",
          }) ?? false : undefined}
        />
      ) : null}
      providerControl={props.providerControl}
      deliberationControl={props.deliberationControl}
      authorityControl={props.authorityControl}
      commandMenu={props.commandMenu}
      onSubmit={handleSubmit}
      onDraftChange={handleDraftChange}
      onKeyDown={handleComposerKeyDown}
      onPaste={handlePaste}
      attachments={(
        <ComposerAttachments
          attachments={attachments}
          onRemove={removeAttachment}
        />
      )}
      feedback={composerError ? (
        <Alert variant="destructive">
          <AlertTitle>Composer input failed</AlertTitle>
          <AlertDescription>{composerError}</AlertDescription>
        </Alert>
      ) : null}
      leadingActions={(
        <ComposerLeadingActions
          planMode={props.planMode}
          governedWorkItemCount={props.governedWorkItemCount}
          fileButtonDisabled={fileButtonDisabled}
          imageButtonDisabled={imageButtonDisabled}
          audioFileInputRef={audioFileInputRef}
          imageFileInputRef={imageFileInputRef}
          onTogglePlanMode={() => props.onTogglePlanMode(!props.planMode)}
          onGovernedWorkItemCountChange={props.onGovernedWorkItemCountChange}
          onAudioFileChange={handleAudioFileChange}
          onImageFileChange={handleImageFileChange}
        />
      )}
      trailingActions={(
        <ComposerTrailingActions
          canSubmit={canSubmit}
          turnActive={props.status === "running"}
          cancelPending={props.cancelPending === true}
          onCancel={props.onCancel}
          voiceButtonDisabled={voiceButtonDisabled}
          voiceState={voiceState}
          onToggleVoiceCapture={toggleVoiceCapture}
        />
      )}
    />
  );
}
