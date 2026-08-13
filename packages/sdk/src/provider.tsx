import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ApiClient } from "./api-client.js";
import type { KilnConfig } from "./types.js";

interface KilnContextValue {
  readonly config: KilnConfig;
  readonly client: ApiClient;
}

const KilnContext = createContext<KilnContextValue | null>(null);

export interface KilnProviderProps {
  readonly config: KilnConfig;
  readonly children: ReactNode;
}

export function KilnProvider({ config, children }: KilnProviderProps): ReactNode {
  const value = useMemo<KilnContextValue>(
    () => ({ config, client: new ApiClient(config.baseUrl) }),
    [config.baseUrl, config.appName, config.userId],
  );

  return <KilnContext value={value}>{children}</KilnContext>;
}

export function useKilnContext(): KilnContextValue {
  const ctx = useContext(KilnContext);
  if (!ctx) {
    throw new Error("useKilnContext must be used within a KilnProvider");
  }
  return ctx;
}
