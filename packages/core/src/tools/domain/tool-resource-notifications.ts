export interface ToolResourceUpdatedNotification {
  readonly method: "notifications/resources/updated";
  readonly params: {
    readonly uri: string;
  };
}

export interface ToolResourceListChangedNotification {
  readonly method: "notifications/resources/list_changed";
}

export type ToolResourceNotification =
  | ToolResourceUpdatedNotification
  | ToolResourceListChangedNotification;

export type ToolResourceNotificationSender = (notification: ToolResourceNotification) => Promise<void>;

export interface ToolResourceChangeNotifier {
  notifyResourceUpdated(uri: string): void;
  notifyResourceListChanged(): void;
}

export interface ToolResourceNotificationHubOptions {
  readonly debounceMs?: number;
}

export interface ToolResourceSessionRegistration {
  readonly sessionId: string;
  readonly sendNotification: ToolResourceNotificationSender;
}

export interface ToolResourceSubscription extends ToolResourceSessionRegistration {
  readonly uri: string;
}

interface ResourceNotificationSession {
  sendNotification: ToolResourceNotificationSender;
  readonly subscriptions: Set<string>;
  readonly pendingUpdatedUris: Set<string>;
  pendingListChanged: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_DEBOUNCE_MS = 25;

export class ToolResourceNotificationHub implements ToolResourceChangeNotifier {
  private readonly sessions = new Map<string, ResourceNotificationSession>();
  private readonly debounceMs: number;

  constructor(options: ToolResourceNotificationHubOptions = {}) {
    this.debounceMs = normalizeDebounceMs(options.debounceMs);
  }

  registerSession(registration: ToolResourceSessionRegistration): void {
    const session = this.sessions.get(registration.sessionId);
    if (session) {
      session.sendNotification = registration.sendNotification;
      return;
    }
    this.sessions.set(registration.sessionId, {
      sendNotification: registration.sendNotification,
      subscriptions: new Set<string>(),
      pendingUpdatedUris: new Set<string>(),
      pendingListChanged: false,
    });
  }

  subscribeResource(subscription: ToolResourceSubscription): void {
    this.registerSession(subscription);
    this.sessions.get(subscription.sessionId)?.subscriptions.add(normalizeResourceUri(subscription.uri));
  }

  unsubscribeResource(request: { readonly sessionId: string; readonly uri: string }): void {
    const session = this.sessions.get(request.sessionId);
    if (!session) {
      return;
    }
    session.subscriptions.delete(normalizeResourceUri(request.uri));
  }

  notifyResourceUpdated(uri: string): void {
    const normalizedUri = normalizeResourceUri(uri);
    for (const session of this.sessions.values()) {
      session.pendingUpdatedUris.add(normalizedUri);
      this.schedule(session);
    }
  }

  notifyResourceListChanged(): void {
    for (const session of this.sessions.values()) {
      session.pendingListChanged = true;
      this.schedule(session);
    }
  }

  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.timer) {
      clearTimeout(session.timer);
    }
    this.sessions.delete(sessionId);
  }

  disposeAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.disposeSession(sessionId);
    }
  }

  private schedule(session: ResourceNotificationSession): void {
    if (session.timer) {
      return;
    }
    session.timer = setTimeout(() => {
      session.timer = undefined;
      void this.flush(session).catch(() => undefined);
    }, this.debounceMs);
    session.timer.unref?.();
  }

  private async flush(session: ResourceNotificationSession): Promise<void> {
    const sendListChanged = session.pendingListChanged;
    const updatedUris = Array.from(session.pendingUpdatedUris);
    session.pendingListChanged = false;
    session.pendingUpdatedUris.clear();

    if (sendListChanged) {
      await session.sendNotification({ method: "notifications/resources/list_changed" });
    }
    for (const uri of updatedUris) {
      if (hasMatchingSubscription(session.subscriptions, uri)) {
        await session.sendNotification({
          method: "notifications/resources/updated",
          params: { uri },
        });
      }
    }
  }
}

function hasMatchingSubscription(subscriptions: ReadonlySet<string>, updatedUri: string): boolean {
  for (const subscription of subscriptions) {
    if (updatedUri === subscription || updatedUri.startsWith(`${subscription}/`)) {
      return true;
    }
  }
  return false;
}

function normalizeResourceUri(uri: string): string {
  return uri.endsWith("/") ? uri.slice(0, -1) : uri;
}

function normalizeDebounceMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DEBOUNCE_MS;
  }
  return Math.max(0, Math.trunc(value));
}
