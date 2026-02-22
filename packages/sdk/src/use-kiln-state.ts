import { useCallback, useState } from "react";
import { useKilnContext } from "./provider.js";
import type { UseStateReturn } from "./types.js";

export function useKilnState(): UseStateReturn {
  const { client } = useKilnContext();
  const [state, setState] = useState<Record<string, unknown>>({});
  const [cost, setCost] = useState<Record<string, unknown>>({});
  const [apps, setApps] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [stateData, costData, appsData] = await Promise.all([
        client.get<Record<string, unknown>>("/dev/state"),
        client.get<Record<string, unknown>>("/dev/cost"),
        client.get<string[]>("/dev/apps"),
      ]);
      setState(stateData);
      setCost(costData);
      setApps(appsData);
    } catch {
      // Fail silently -- dev endpoints may not be available
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  return { state, cost, apps, isLoading, refresh };
}
