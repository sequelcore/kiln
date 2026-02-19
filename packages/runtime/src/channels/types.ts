// Channel adapter types: configuration, status, and identity mapping

import type { MessageFormat } from "@kiln/core";

/** Configuration for a channel adapter */
export interface ChannelConfig {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  readonly maxMessageLength?: number;
  readonly rateLimitPerMinute?: number;
}

/** Runtime status of a channel adapter */
export type ChannelStatus = "connected" | "disconnected" | "error";

/** Maps a platform-specific user ID to an engine user ID */
export interface IdentityMapping {
  readonly platformUserId: string;
  readonly channelName: string;
  readonly engineUserId: string;
}

/** Resolves platform user identities to engine user IDs */
export interface IdentityResolver {
  resolve(channelName: string, platformUserId: string): Promise<string | null>;
}

/** In-memory identity resolver for development and testing */
export class InMemoryIdentityResolver implements IdentityResolver {
  private readonly mappings = new Map<string, string>();

  addMapping(channelName: string, platformUserId: string, engineUserId: string): void {
    this.mappings.set(`${channelName}:${platformUserId}`, engineUserId);
  }

  async resolve(channelName: string, platformUserId: string): Promise<string | null> {
    return this.mappings.get(`${channelName}:${platformUserId}`) ?? null;
  }
}
