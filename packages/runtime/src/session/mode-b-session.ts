import type { AgentMessage, ContentPart } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { SessionMode } from "./session-mode.js";
import { transitionSessionMode } from "./session-mode.js";

export interface SerializedSessionData {
  readonly id: string;
  readonly appName: string;
  readonly tenantId?: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly idleTimeoutMs: number;
  readonly sessionMode: SessionMode;
  readonly version: number;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly history: readonly AgentMessage[];
}

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
  private _version = 0;
  private _loadedVersion = 0;

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

  get idleTimeoutMs(): number {
    return this._idleTimeoutMs;
  }

  /** Optimistic concurrency version. Incremented on every mutation. */
  get version(): number {
    return this._version;
  }

  /** Version when this session was loaded from the store (for conflict detection). */
  get loadedVersion(): number {
    return this._loadedVersion;
  }

  static fromSerialized(data: SerializedSessionData): ModeBSession {
    const session = new ModeBSession({
      appName: data.appName,
      tenantId: data.tenantId,
      userId: data.userId,
      systemPrompt: data.systemPrompt,
      idleTimeoutMs: data.idleTimeoutMs,
    });
    // Override auto-generated values with serialized state
    (session as { id: string }).id = data.id;
    (session as { createdAt: Date }).createdAt = new Date(data.createdAt);
    (session as unknown as { _lastActivityAt: Date })._lastActivityAt = new Date(data.lastActivityAt);
    (session as unknown as { _sessionMode: SessionMode })._sessionMode = data.sessionMode;
    // Replay history
    for (const msg of data.history) {
      if (msg.role === "user") session.addUserMessage(msg.parts);
      else session.addAssistantMessage(msg.parts);
    }
    // Re-set lastActivityAt since addMessage calls touch()
    (session as unknown as { _lastActivityAt: Date })._lastActivityAt = new Date(data.lastActivityAt);
    // Restore version and record loaded version for conflict detection
    const storedVersion = data.version ?? 0;
    (session as unknown as { _version: number })._version = storedVersion;
    (session as unknown as { _loadedVersion: number })._loadedVersion = storedVersion;
    return session;
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
    this._version++;
  }

  get sessionMode(): SessionMode {
    return this._sessionMode;
  }

  setSessionMode(mode: SessionMode): void {
    this._sessionMode = transitionSessionMode(this._sessionMode, mode);
    this._version++;
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
