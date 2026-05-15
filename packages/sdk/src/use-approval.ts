import { useCallback, useState } from "react";
import { useKilnContext } from "./provider.js";

export interface UseApprovalReturn {
  readonly approve: (approvalId: string) => Promise<void>;
  readonly reject: (reason: string, approvalId: string) => Promise<void>;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

export function useApproval(): UseApprovalReturn {
  const { client } = useKilnContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const approve = useCallback(
    async (approvalId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await client.post<{ ok: true }>("/dev/approve", { approvalId });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const reject = useCallback(
    async (reason: string, approvalId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await client.post<{ ok: true }>("/dev/reject", { reason, approvalId });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  return { approve, reject, isLoading, error };
}
