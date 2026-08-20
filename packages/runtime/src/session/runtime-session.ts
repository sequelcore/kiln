import type {
  AgentMessage,
  BoundedWorkAdoptionAuthority,
  CanonicalSessionEvent,
  ContentPart,
} from "@kilnai/core";
import { compareSessionEvents, extractText } from "@kilnai/core";
import type { SessionMode } from "./session-mode.js";
import { transitionSessionMode } from "./session-mode.js";

export interface AgentTurnEntry {
  readonly agentId: string;
  readonly turnIndex: number;
  readonly handoffBrief?: string;
  readonly fromAgentId?: string;
}

export interface SerializedSessionData {
  readonly id: string;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly idleTimeoutMs: number;
  readonly sessionMode: SessionMode;
  readonly version: number;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly history: readonly AgentMessage[];
  readonly activeAgentId: string | null;
  readonly agentTurnHistory: readonly AgentTurnEntry[];
  readonly handoffCount: number;
  readonly lastRouteChangeAt: number;
  readonly totalTokens?: number;
  readonly userTurnCount?: number;
  readonly lastHumanMessageAt?: number | null;
  readonly userContext?: Record<string, string>;
  readonly sessionLedger?: {
    readonly currentPhase: string;
    readonly lastError?: string;
    readonly lastProvider?: string;
    readonly toolCallCount?: number;
    readonly turnDepth?: number;
    readonly lastSummary?: string;
  };
  readonly exactArtifacts?: readonly string[];
  readonly sessionEvents?: ReadonlyArray<Omit<CanonicalSessionEvent, "timestamp"> & { readonly timestamp: string }>;
}

export interface RuntimeSessionConfig {
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly idleTimeoutMs?: number;
  readonly sessionId?: string;
}

export class RuntimeSession {
  readonly id: string;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly createdAt: Date;

  private _lastActivityAt: Date;
  private _systemPrompt: string;
  private readonly _idleTimeoutMs: number;
  private readonly _history: AgentMessage[] = [];
  private _sessionMode: SessionMode = "ai_active";
  private _version = 0;
  private _loadedVersion = 0;
  private _activeAgentId: string | null = null;
  private _agentTurnHistory: AgentTurnEntry[] = [];
  private _handoffCount = 0;
  private _lastRouteChangeAt = 0;
  private _totalTokens = 0;
  private _userTurnCount = 0;
  private _lastHumanMessageAt: number | null = null;
  private _userContext: Record<string, string> | undefined = undefined;
  private _sessionLedger: {
    currentPhase: string;
    lastError?: string;
    lastProvider?: string;
    toolCallCount?: number;
    turnDepth?: number;
    lastSummary?: string;
  } = { currentPhase: "active" };
  private _exactArtifacts: string[] = [];
  private _sessionEvents: CanonicalSessionEvent[] = [];

  constructor(config: RuntimeSessionConfig) {
    this.appName = config.appName;
    this.tenantId = config.tenantId;
    this.userId = config.userId;
    this._systemPrompt = config.systemPrompt;
    this._idleTimeoutMs = config.idleTimeoutMs ?? 30 * 60 * 1000;
    this.createdAt = new Date();
    this._lastActivityAt = new Date();
    this.id = config.sessionId ?? `${config.appName}:${config.tenantId}:${config.userId}:${Date.now()}`;
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

  static fromSerialized(data: SerializedSessionData): RuntimeSession {
    const session = new RuntimeSession({
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
    // Restore agent routing state
    (session as unknown as { _activeAgentId: string | null })._activeAgentId = data.activeAgentId;
    (session as unknown as { _agentTurnHistory: AgentTurnEntry[] })._agentTurnHistory = [...data.agentTurnHistory];
    (session as unknown as { _handoffCount: number })._handoffCount = data.handoffCount;
    (session as unknown as { _lastRouteChangeAt: number })._lastRouteChangeAt = data.lastRouteChangeAt;
    // Restore token/turn counters (userTurnCount was incremented during history replay -- override with stored value)
    (session as unknown as { _totalTokens: number })._totalTokens = data.totalTokens ?? 0;
    if (data.userTurnCount !== undefined) {
      (session as unknown as { _userTurnCount: number })._userTurnCount = data.userTurnCount;
    }
    // Restore coexistence timestamp
    if (data.lastHumanMessageAt != null) {
      (session as unknown as { _lastHumanMessageAt: number | null })._lastHumanMessageAt = data.lastHumanMessageAt;
    }
    // Restore user context
    if (data.userContext) {
      (session as unknown as { _userContext: Record<string, string> })._userContext = data.userContext;
    }
    if (data.sessionLedger) {
      (session as unknown as { _sessionLedger: typeof session._sessionLedger })._sessionLedger = { ...data.sessionLedger };
    }
    if (data.exactArtifacts) {
      (session as unknown as { _exactArtifacts: string[] })._exactArtifacts = [...data.exactArtifacts];
    }
    if (data.sessionEvents) {
      const replayEvents = data.sessionEvents
        .filter((event) => event.kilnSessionId === session.id)
        .map((event) => ({
          ...event,
          timestamp: new Date(event.timestamp),
        }) as CanonicalSessionEvent)
        .sort((left, right) => compareSessionEvents(left, right));
      // Hydrate through the same session authority used by live appends. A
      // persisted payload may be mixed or foreign; foreign events are not
      // allowed into this session's replay ledger.
      session.appendSessionEvents(replayEvents);
    }
    // Restore version and record loaded version for conflict detection
    const storedVersion = data.version;
    (session as unknown as { _version: number })._version = storedVersion;
    (session as unknown as { _loadedVersion: number })._loadedVersion = storedVersion;
    return session;
  }

  addUserMessage(parts: readonly ContentPart[]): void {
    this._history.push({ role: "user", parts });
    this._userTurnCount++;
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

  get activeAgentId(): string | null {
    return this._activeAgentId;
  }

  get agentTurnHistory(): readonly AgentTurnEntry[] {
    return this._agentTurnHistory;
  }

  get handoffCount(): number {
    return this._handoffCount;
  }

  get lastRouteChangeAt(): number {
    return this._lastRouteChangeAt;
  }

  get totalTokens(): number {
    return this._totalTokens;
  }

  get userTurnCount(): number {
    return this._userTurnCount;
  }

  get lastHumanMessageAt(): number | null {
    return this._lastHumanMessageAt;
  }

  recordHumanMessage(): void {
    this._lastHumanMessageAt = Date.now();
    this._version++;
  }

  accumulateTokens(count: number): void {
    this._totalTokens += count;
  }

  setActiveAgent(agentId: string, handoffBrief?: string): void {
    if (this._activeAgentId === agentId) return;
    const fromAgentId = this._activeAgentId ?? undefined;
    this._activeAgentId = agentId;
    this._agentTurnHistory.push({ agentId, turnIndex: this._history.length, handoffBrief, fromAgentId });
    this._handoffCount++;
    this._lastRouteChangeAt = this._history.length;
    this._version++;
  }

  setSystemPrompt(prompt: string): void {
    this._systemPrompt = prompt;
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

  get userContext(): Record<string, string> | undefined {
    return this._userContext;
  }

  get sessionLedger(): {
    readonly currentPhase: string;
    readonly lastError?: string;
    readonly lastProvider?: string;
    readonly toolCallCount?: number;
    readonly turnDepth?: number;
    readonly lastSummary?: string;
  } {
    return this._sessionLedger;
  }

  get exactArtifacts(): readonly string[] {
    return this._exactArtifacts;
  }

  get sessionEvents(): readonly CanonicalSessionEvent[] {
    return this._sessionEvents;
  }

  nextSessionEventSequence(): number {
    const lastEvent = this._sessionEvents[this._sessionEvents.length - 1];
    return lastEvent ? lastEvent.sequence + 1 : 1;
  }

  appendSessionEvents(events: readonly CanonicalSessionEvent[]): void {
    if (events.length === 0) {
      return;
    }
    const expectedStartSequence = this.nextSessionEventSequence();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!event) {
        continue;
      }
      if (event.kilnSessionId !== this.id) {
        throw new Error(`Session event kilnSessionId mismatch: expected ${this.id}, received ${event.kilnSessionId}`);
      }
      const expectedSequence = expectedStartSequence + index;
      if (event.sequence !== expectedSequence) {
        throw new Error(`Session event sequence mismatch: expected ${expectedSequence}, received ${event.sequence}`);
      }
      this.assertAdoptionDecisionReplay(event, [...this._sessionEvents, ...events.slice(0, index)]);
    }
    this._sessionEvents = [...this._sessionEvents, ...events];
    this._version++;
  }

  private assertAdoptionDecisionReplay(
    event: CanonicalSessionEvent,
    priorEvents: readonly CanonicalSessionEvent[],
  ): void {
    let sourceTurnId: string | undefined;
    if (event.kind === "goal.created" && event.goal.source.kind === "operator_direct") {
      sourceTurnId = event.goal.source.turnId;
    } else if (event.kind === "goal.updated" && event.changedFields.includes("boundedWorkContractRevision")) {
      sourceTurnId = event.turnId;
    } else {
      return;
    }
    if (!sourceTurnId) {
      throw new Error(`Goal ${event.goal.id} bounded-work adoption is missing its canonical turn identity.`);
    }
    if (event.kind === "goal.created" && event.turnId !== sourceTurnId) {
      throw new Error(`Goal ${event.goal.id} adoption event turn does not match its canonical source turn.`);
    }
    const decision = priorEvents
      .filter((candidate): candidate is Extract<CanonicalSessionEvent, { readonly kind: "operator_adoption_decision" }> =>
        candidate.kind === "operator_adoption_decision")
      .find((candidate) => candidate.turnId === sourceTurnId);
    if (!decision || decision.sequence >= event.sequence) {
      throw new Error(`Goal ${event.goal.id} has no preceding canonical operator adoption decision for ${sourceTurnId}.`);
    }
    if (
      decision.ownerSessionId !== event.goal.ownerSessionId
      || decision.operatorTurnId !== sourceTurnId
      || !sameAdoptionAuthority(decision.contractAuthority, event.goal.boundedWorkContractRevision.adoptedBy)
    ) {
      throw new Error(`Goal ${event.goal.id} adoption authority does not match the canonical operator decision.`);
    }
  }


  /** Merges keys from ctx into the stored user context. Empty object is a no-op. */
  updateUserContext(ctx: Record<string, string>): void {
    if (Object.keys(ctx).length === 0) return;
    this._userContext = { ...this._userContext, ...ctx };
    this._version++;
  }

  /** Replaces user context entirely. Pass undefined to clear. */
  setUserContext(ctx: Record<string, string> | undefined): void {
    this._userContext = ctx;
    this._version++;
  }

  updateSessionLedger(
    updates: Partial<{
      currentPhase: string;
      lastError?: string;
      lastProvider?: string;
      toolCallCount?: number;
      turnDepth?: number;
      lastSummary?: string;
    }>,
  ): void {
    this._sessionLedger = { ...this._sessionLedger, ...updates };
    this._version++;
  }

  addExactArtifact(artifact: string): void {
    const trimmed = artifact.trim();
    if (trimmed === "") return;
    if (this._exactArtifacts.includes(trimmed)) return;
    this._exactArtifacts.push(trimmed);
    if (this._exactArtifacts.length > 20) {
      this._exactArtifacts = this._exactArtifacts.slice(-20);
    }
    this._version++;
  }
}

function sameAdoptionAuthority(
  left: BoundedWorkAdoptionAuthority,
  right: BoundedWorkAdoptionAuthority,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "operator" && right.kind === "operator") {
    return left.actorId === right.actorId && left.decisionId === right.decisionId;
  }
  return left.kind === "approved_plan"
    && right.kind === "approved_plan"
    && left.planId === right.planId
    && left.planDigest === right.planDigest;
}
