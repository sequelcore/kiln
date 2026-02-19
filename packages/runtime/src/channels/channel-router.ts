// ChannelRouter: routes incoming channel messages to teams via Router composite
// Bridges Channel.receive() -> IdentityResolver -> Router pattern matching -> Team dispatch

import type { IncomingMessage, OutgoingMessage } from "@kilnai/core";
import type { IdentityResolver } from "./types.js";
import type { ChannelRegistry } from "./channel-registry.js";

/** Result of routing an incoming message */
export interface RouteResult {
  readonly team: string;
  readonly engineUserId: string | null;
  readonly channelName: string;
  readonly message: IncomingMessage;
}

/** Router rules for pattern-based team selection */
export interface ChannelRouterRule {
  readonly match: RegExp;
  readonly team: string;
}

/**
 * Routes incoming channel messages through identity resolution and pattern matching.
 *
 * Flow: IncomingMessage -> IdentityResolver -> pattern rules -> fallback team
 *
 * After routing, the message can be dispatched to the correct team for processing,
 * and the response sent back through the originating channel.
 */
export class ChannelRouter {
  private readonly rules: ChannelRouterRule[];
  private readonly fallbackTeam: string;
  private readonly identityResolver: IdentityResolver | null;
  private readonly registry: ChannelRegistry;
  private routeHandler: ((result: RouteResult) => Promise<OutgoingMessage | null>) | null = null;

  constructor(options: {
    rules?: ChannelRouterRule[];
    fallbackTeam: string;
    identityResolver?: IdentityResolver;
    registry: ChannelRegistry;
  }) {
    this.rules = options.rules ?? [];
    this.fallbackTeam = options.fallbackTeam;
    this.identityResolver = options.identityResolver ?? null;
    this.registry = options.registry;
  }

  /** Register a handler that processes routed messages and returns a response */
  onRoute(handler: (result: RouteResult) => Promise<OutgoingMessage | null>): void {
    this.routeHandler = handler;
  }

  /** Route an incoming message from a named channel */
  async route(channelName: string, message: IncomingMessage): Promise<RouteResult> {
    // 1. Resolve identity
    let engineUserId: string | null = null;
    if (this.identityResolver && message.userId) {
      engineUserId = await this.identityResolver.resolve(channelName, message.userId);
    }

    // 2. Match pattern rules against message content
    let team = this.fallbackTeam;
    for (const rule of this.rules) {
      if (rule.match.test(message.content)) {
        team = rule.team;
        break;
      }
    }

    const result: RouteResult = {
      team,
      engineUserId,
      channelName,
      message,
    };

    // 3. Dispatch to handler and send response back
    if (this.routeHandler) {
      const response = await this.routeHandler(result);
      if (response) {
        const channel = this.registry.get(channelName);
        if (channel) {
          await channel.send(response);
        }
      }
    }

    return result;
  }

  /** Resolve team name for a message content string */
  resolveTeam(content: string): string {
    for (const rule of this.rules) {
      if (rule.match.test(content)) {
        return rule.team;
      }
    }
    return this.fallbackTeam;
  }
}
