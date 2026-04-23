export interface ManagedGuiWindowShutdownMonitor {
  readonly onConnectionCountChange: (count: number) => void;
  readonly onManagedWindowClose: () => void;
  waitForDisconnect(): Promise<void>;
  dispose(): void;
}

const MANAGED_GUI_DISCONNECT_GRACE_MS = 1_500;

export function createManagedGuiWindowShutdownMonitor(
  disconnectGraceMs = MANAGED_GUI_DISCONNECT_GRACE_MS,
): ManagedGuiWindowShutdownMonitor {
  let sawConnection = false;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveDisconnect!: () => void;
  const disconnectPromise = new Promise<void>((resolve) => {
    resolveDisconnect = resolve;
  });
  let settled = false;

  const clearDisconnectTimer = () => {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  };

  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearDisconnectTimer();
    resolveDisconnect();
  };

  return {
    onManagedWindowClose() {
      settle();
    },
    onConnectionCountChange(count: number) {
      if (count > 0) {
        sawConnection = true;
        clearDisconnectTimer();
        return;
      }

      if (!sawConnection || settled || disconnectTimer) {
        return;
      }

      disconnectTimer = setTimeout(() => {
        disconnectTimer = null;
        settle();
      }, disconnectGraceMs);
    },
    waitForDisconnect() {
      return disconnectPromise;
    },
    dispose() {
      clearDisconnectTimer();
    },
  };
}
