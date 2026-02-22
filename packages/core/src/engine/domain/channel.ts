// Engine primitive: Channel -- input/output adapter for external platforms
// Agents produce content; channels format for the platform

import type { ContentPart } from "./content.js";
import type { Modality } from "./modality.js";

/** Message format hint for channel-specific rendering */
export type MessageFormat = "short" | "full" | "structured";

/** An incoming message from an external source */
export interface IncomingMessage {
  readonly parts: readonly ContentPart[];
  readonly source: string;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** An outgoing response to an external target */
export interface OutgoingMessage {
  readonly parts: readonly ContentPart[];
  readonly target: string;
  readonly format?: MessageFormat;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** An event emitted by the engine for real-time monitoring */
export interface EngineEvent {
  readonly type: string;
  readonly timestamp: Date;
  readonly payload: Record<string, unknown>;
}

/** Input/output adapter connecting the engine to external platforms */
export interface Channel {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  readonly supportedModalities: readonly Modality[];
  receive(message: IncomingMessage): Promise<void>;
  send(response: OutgoingMessage): Promise<void>;
  stream(events: AsyncIterable<EngineEvent>): Promise<void>;
}
