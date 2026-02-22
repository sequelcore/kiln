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

interface AppGraphRouter {
  rules: { pattern: string; team: string }[];
  fallback: string;
  classifier?: string;
}

interface AppGraphResponse {
  name: string;
  teams: AppGraphTeam[];
  router: AppGraphRouter;
  channels: string[];
  triggers: string[];
  hasKnowledge: boolean;
  hasEval: boolean;
  hasSafety: boolean;
}

export function useAppGraph() {
  const { client } = useKilnContext();

  return useQuery({
    queryKey: ["app-graph"],
    queryFn: () => client.get<AppGraphResponse>("/dev/app-graph"),
  });
}

export type { AppGraphResponse, AppGraphTeam, AppGraphAgent, AppGraphRouter };
