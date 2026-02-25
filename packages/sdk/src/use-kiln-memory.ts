import { useCallback, useState } from "react";
import { useKilnContext } from "./provider.js";
import type { CreateMemoryInput, MemoryEntry, UseMemoryReturn } from "./types.js";

/**
 * Read, create, and delete memory entries via the gateway memory API.
 */
export function useKilnMemory(scope: string): UseMemoryReturn {
  const { client } = useKilnContext();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await client.get<MemoryEntry[]>(`/api/memory/${scope}`);
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [client, scope]);

  const create = useCallback(
    async (entry: CreateMemoryInput) => {
      setError(null);
      try {
        await client.post("/api/memory", { ...entry, scope });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [client, scope, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await client.delete(`/api/memory/${id}`);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [client, refresh],
  );

  return { entries, isLoading, error, refresh, create, remove };
}
