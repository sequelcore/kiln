import { useCallback, useState } from "react";
import { useKilnContext } from "./provider.js";
import type { UseStateReturn } from "./types.js";

/**
 * Hook to fetch dev-mode gateway state (state, cost, loaded apps).
 * Only works when connected to a dev-mode gateway (`/dev/*` routes).
 */
export function useKilnState(): UseStateReturn {
  const { client } = useKilnContext();
  const [state, setState] = useState<Record<string, unknown>>({});
  const [cost, setCost] = useState<Record<string, unknown>>({});
  const [apps, setApps] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [stateData, costData, appsData] = await Promise.all([
        client.get<Record<string, unknown>>("/dev/state"),
        client.get<Record<string, unknown>>("/dev/cost"),
        client.get<{ readonly apps?: readonly string[] }>("/dev/apps"),
      ]);
      setState(stateData);
      setCost(costData);
      setApps([...(appsData.apps ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  return { state, cost, apps, isLoading, error, refresh };
}
