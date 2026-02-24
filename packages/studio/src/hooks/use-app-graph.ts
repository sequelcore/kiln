import { useQuery } from "@tanstack/react-query";
import { useKilnContext } from "@kilnai/react";

interface AppGraphAgent {
  name: string;
  role: string;
  goal?: string;
  tier: string;
  tools: string[];
  modalities?: string[];
}

interface AppGraphTeam {
  name: string;
  agents: AppGraphAgent[];
  capabilities: string[];
  phases: string[];
  mode?: string;
}

interface AppGraphResponse {
  name: string;
  teams: AppGraphTeam[];
  router: { rules: { pattern: string; team: string }[]; fallback: string; classifier?: string };
}

export function useAppGraph() {
  const { client } = useKilnContext();

  return useQuery({
    queryKey: ["app-graph"],
    queryFn: () => client.get<AppGraphResponse>("/dev/app-graph"),
  });
}

export type { AppGraphTeam, AppGraphAgent };
