// ChannelRegistry: manages multiple Channel instances for multi-channel apps

import type { Channel, OutgoingMessage, EngineEvent } from "@kilnai/core";

/**
 * Registry for managing multiple Channel instances.
 * Provides broadcast (send to all) and targeted (send to one) delivery.
 */
export class ChannelRegistry {
  private readonly channels = new Map<string, Channel>();

  /** Register a channel adapter */
  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  /** Unregister a channel by name */
  unregister(name: string): boolean {
    return this.channels.delete(name);
  }

  /** Get a specific channel by name */
  get(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  /** Get all registered channels */
  getAll(): readonly Channel[] {
    return [...this.channels.values()];
  }

  /** Number of registered channels */
  get size(): number {
    return this.channels.size;
  }

  /** Send a response to a specific channel by name */
  async sendTo(name: string, message: OutgoingMessage): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel) return false;
    await channel.send(message);
    return true;
  }

  /** Broadcast a response to all registered channels */
  async broadcast(message: OutgoingMessage): Promise<void> {
    const sends = [...this.channels.values()].map((ch) => ch.send(message));
    await Promise.allSettled(sends);
  }

  /** Start streaming events to a specific channel */
  async streamTo(name: string, events: AsyncIterable<EngineEvent>): Promise<void> {
    const channel = this.channels.get(name);
    if (!channel) return;
    await channel.stream(events);
  }
}
