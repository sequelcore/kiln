// Response types for Studio dev API endpoints

export interface AppGraphAgent {
  readonly name: string;
  readonly role: string;
  readonly goal?: string;
  readonly tier: string;
  readonly tools: readonly string[];
  readonly modalities?: readonly string[];
}

export interface AppGraphTeam {
  readonly name: string;
  readonly agents: readonly AppGraphAgent[];
  readonly capabilities: readonly string[];
  readonly phases: readonly string[];
  readonly mode?: string;
}

export interface AppGraphRouter {
  readonly rules: readonly { readonly pattern: string; readonly team: string }[];
  readonly fallback: string;
  readonly classifier?: string;
}

export interface AppGraphResponse {
  readonly name: string;
  readonly teams: readonly AppGraphTeam[];
  readonly router: AppGraphRouter;
  readonly channels: readonly string[];
  readonly triggers: readonly string[];
  readonly hasKnowledge: boolean;
  readonly hasEval: boolean;
  readonly hasSafety: boolean;
}

export interface EvalExperimentSummary {
  readonly name: string;
  readonly dataset?: string;
  readonly scorers: readonly string[];
}
