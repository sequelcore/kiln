import { useQuery } from "@tanstack/react-query";

interface GatewayHealthResponse {
  readonly status: string;
}

async function fetchGatewayHealth(): Promise<GatewayHealthResponse> {
  const response = await fetch("/health", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Gateway health check failed: ${response.status}`);
  }
  return response.json() as Promise<GatewayHealthResponse>;
}

export function useGatewayHealth() {
  return useQuery({
    queryKey: ["gateway", "health"],
    queryFn: fetchGatewayHealth,
    retry: 1,
    staleTime: 10_000,
  });
}
