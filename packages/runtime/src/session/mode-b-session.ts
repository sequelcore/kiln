import type { AgentMessage, ContentPart } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { SessionMode } from "./session-mode.js";
import { transitionSessionMode } from "./session-mode.js";

export interface ModeBSessionConfig {
  readonly appName: string;
  readonly tenantId?: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly idleTimeoutMs?: number;
}

export class ModeBSession {
  readonly id: string;
  readonly appName: string;
  readonly tenantId: string | undefined;
  readonly userId: string;
  readonly createdAt: Date;

  private _lastActivityAt: Date;
  private readonly _systemPrompt: string;
  private readonly _idleTimeoutMs: number;
  private readonly _history: AgentMessage[] = [];
  private _sessionMode: SessionMode = "ai_active";

  constructor(config: ModeBSessionConfig) {
    this.appName = config.appName;
    this.tenantId = config.tenantId;
    this.userId = config.userId;
    this._systemPrompt = config.systemPrompt;
    this._idleTimeoutMs = config.idleTimeoutMs ?? 30 * 60 * 1000;
    this.createdAt = new Date();
    this._lastActivityAt = new Date();
    this.id = config.tenantId
      ? `${config.appName}:${config.tenantId}:${config.userId}:${Date.now()}`
      : `${config.appName}:${config.userId}:${Date.now()}`;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  get isExpired(): boolean {
    return Date.now() - this._lastActivityAt.getTime() > this._idleTimeoutMs;
  }

  get messageCount(): number {
    return this._history.length;
  }

  get conversationHistory(): readonly AgentMessage[] {
    return this._history;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  addUserMessage(parts: readonly ContentPart[]): void {
    this._history.push({ role: "user", parts });
    this.touch();
  }

  addAssistantMessage(parts: readonly ContentPart[]): void {
    this._history.push({ role: "assistant", parts });
    this.touch();
  }

  touch(): void {
    this._lastActivityAt = new Date();
  }

  get sessionMode(): SessionMode {
    return this._sessionMode;
  }

  setSessionMode(mode: SessionMode): void {
    this._sessionMode = transitionSessionMode(this._sessionMode, mode);
  }

  lastAssistantTexts(count: number): string[] {
    const texts: string[] = [];
    for (let i = this._history.length - 1; i >= 0 && texts.length < count; i--) {
      if (this._history[i]!.role === "assistant") {
        texts.push(extractText(this._history[i]!.parts));
      }
    }
    return texts.reverse();
  }

  injectOperatorMessage(parts: readonly ContentPart[]): void {
    this._history.push({ role: "assistant", parts });
    this.touch();
  }
}
