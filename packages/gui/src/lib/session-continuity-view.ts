import type { SessionContinuity } from "./session-continuity.js";

export type SessionContinuityTone = "muted" | "accent" | "info" | "warning" | "danger";

export interface ComposerContinuityHint {
  readonly label: string;
  readonly description: string;
  readonly tone: SessionContinuityTone;
  readonly prominence: "routine" | "exceptional";
}

export interface SessionRowBadge {
  readonly label: string;
  readonly tone: SessionContinuityTone;
}

export type SessionRowOutcome = "failed" | "cancelled";

export function buildComposerContinuityHint(continuity: SessionContinuity): ComposerContinuityHint {
  if (continuity.mode === "detached") {
    return {
      label: "Detached",
      description: "Run continues in background",
      tone: "warning",
      prominence: "exceptional",
    };
  }
  if (continuity.status === "running") {
    return {
      label: "Running",
      description: "Waiting for current turn",
      tone: "info",
      prominence: "exceptional",
    };
  }
  if (continuity.mode === "continue") {
    return {
      label: "Continue chat",
      description: "Next message continues selected session",
      tone: "accent",
      prominence: "routine",
    };
  }
  if (continuity.mode === "fresh") {
    return {
      label: "New session",
      description: "Next message starts fresh",
      tone: "muted",
      prominence: "routine",
    };
  }
  return {
    label: "Live",
    description: "Next message continues current session",
    tone: "info",
    prominence: "routine",
  };
}

export function buildSessionRowBadges(input: {
  readonly sessionId: string;
  readonly continuity: SessionContinuity;
  readonly outcome?: SessionRowOutcome | null;
}): readonly SessionRowBadge[] {
  const badges: SessionRowBadge[] = [];
  if (input.continuity.detachedSessionIds.includes(input.sessionId)) {
    badges.push({ label: "Detached", tone: "warning" });
  } else if (input.continuity.liveSessionId === input.sessionId && input.continuity.status === "running") {
    badges.push({ label: "Running", tone: "info" });
  } else if (input.continuity.liveSessionId === input.sessionId) {
    badges.push({ label: "Live", tone: "info" });
  } else if (input.continuity.continuationTargetId === input.sessionId) {
    badges.push({ label: "Continue", tone: "accent" });
  } else if (input.continuity.selectedSessionId === input.sessionId) {
    badges.push({ label: "Continue", tone: "accent" });
  }

  if (input.outcome === "failed") {
    badges.push({ label: "Failed", tone: "danger" });
  } else if (input.outcome === "cancelled") {
    badges.push({ label: "Cancelled", tone: "muted" });
  }

  return badges;
}
