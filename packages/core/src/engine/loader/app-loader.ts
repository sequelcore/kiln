// Engine loader: AppLoader -- parses App YAML into typed composites
// Validates dependency graph: team refs in router must exist in teams

import { parse } from "yaml";
import type { App, MemoryConfig } from "../composites/app.js";
import { validateApp } from "../composites/app.js";
import type { Team, QualityGate } from "../composites/team.js";
import type { Router, PatternRule } from "../composites/router.js";
import type { Agent, AgentTier } from "../domain/agent.js";
import type { Capability } from "../domain/capability.js";
import type { Workflow, Gate } from "../domain/workflow.js";
import type { MemoryScope } from "../domain/memory.js";

/** Error class for YAML loader failures, aggregating all validation errors */
export class AppLoaderError extends Error {
  constructor(readonly errors: readonly { field: string; message: string }[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super(`Invalid app YAML:\n${msg}`);
    this.name = "AppLoaderError";
  }
}

// ---------------------------------------------------------------------------
// Internal YAML shape types (unvalidated raw structure from parse())
// ---------------------------------------------------------------------------

interface RawAgent {
  name?: unknown;        // Persona name (e.g., "Aria") -- REQUIRED
  tier?: unknown;
  tools?: unknown;
  role?: unknown;        // Expertise / function -- REQUIRED
  goal?: unknown;        // What agent is trying to achieve -- REQUIRED
  backstory?: unknown;   // Personality, perspective -- optional
  instructions?: unknown; // Operating rules and constraints -- optional
  structured?: unknown;
  count?: unknown;
  sandbox?: unknown;
  // systemPrompt REMOVED -- replaced by auto-assembled prompt
}

interface RawGate {
  requires?: unknown;
}

interface RawWorkflow {
  phases?: unknown;
  gates?: unknown;
  maxIterations?: unknown;
}

interface RawCapability {
  name?: unknown;
  description?: unknown;
  schema?: unknown;
  tags?: unknown;
  annotations?: unknown;
  type?: unknown;
  targetApp?: unknown;
  task?: unknown;
  timeout?: unknown;
}

interface RawQualityGate {
  name?: unknown;
  command?: unknown;
  description?: unknown;
  required?: unknown;
}

interface RawTeam {
  agents?: unknown;
  workflow?: unknown;
  capabilities?: unknown;
  qualityGates?: unknown;
  quality?: unknown;
}

interface RawRule {
  match?: unknown;
  team?: unknown;
}

interface RawRouter {
  rules?: unknown;
  classifier?: unknown;
  fallback?: unknown;
}

interface RawMemory {
  scopes?: unknown;
  backend?: unknown;
  sync?: unknown;
}

interface RawApp {
  name?: unknown;
  channels?: unknown;
  memory?: unknown;
  router?: unknown;
  teams?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const VALID_TIERS: AgentTier[] = ["reasoning", "coding", "fast"];

function mapAgent(identifier: string, raw: RawAgent, path: string): { agent: Agent; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  // name: persona name from YAML (required) -- falls back to identifier for safety
  const name = typeof raw.name === "string" && raw.name.trim() !== ""
    ? raw.name.trim()
    : identifier;
  if (!raw.name || typeof raw.name !== "string" || raw.name.trim() === "") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string (persona name)" });
  }

  // role: expertise / function (required)
  const role = typeof raw.role === "string" ? raw.role.trim() : "";
  if (!raw.role || typeof raw.role !== "string" || raw.role.trim() === "") {
    errors.push({ field: `${path}.role`, message: "must be a non-empty string (expertise/function)" });
  }

  // goal: what agent is trying to achieve (required)
  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  if (!raw.goal || typeof raw.goal !== "string" || raw.goal.trim() === "") {
    errors.push({ field: `${path}.goal`, message: "must be a non-empty string (what agent achieves)" });
  }

  // tier: model class (required)
  const tier = raw.tier;
  if (!tier || !VALID_TIERS.includes(tier as AgentTier)) {
    errors.push({ field: `${path}.tier`, message: `must be one of: ${VALID_TIERS.join(", ")}` });
  }

  // tools: capability references (can be [])
  const tools: string[] = [];
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      errors.push({ field: `${path}.tools`, message: "must be an array" });
    } else {
      for (const t of raw.tools) {
        if (typeof t !== "string") {
          errors.push({ field: `${path}.tools`, message: "all entries must be strings" });
          break;
        }
        tools.push(t);
      }
    }
  }

  const agent: Agent = {
    name,
    role,
    goal,
    tier: (tier as AgentTier) ?? "coding",
    tools,
    ...(typeof raw.backstory === "string" ? { backstory: raw.backstory.trim() } : {}),
    ...(typeof raw.instructions === "string" ? { instructions: raw.instructions.trim() } : {}),
    ...(typeof raw.structured === "boolean" ? { structured: raw.structured } : {}),
    ...(typeof raw.count === "number" ? { count: raw.count } : {}),
    ...(typeof raw.sandbox === "boolean" ? { sandbox: raw.sandbox } : {}),
  };

  return { agent, errors };
}

function mapWorkflow(raw: RawWorkflow, path: string): { workflow: Workflow; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const phases: string[] = [];
  if (!raw.phases || !Array.isArray(raw.phases)) {
    errors.push({ field: `${path}.phases`, message: "must be a non-empty array" });
  } else {
    for (const p of raw.phases) {
      if (typeof p !== "string") {
        errors.push({ field: `${path}.phases`, message: "all entries must be strings" });
        break;
      }
      phases.push(p);
    }
  }

  const gates: Record<string, Gate> = {};
  if (raw.gates !== undefined) {
    if (typeof raw.gates !== "object" || raw.gates === null || Array.isArray(raw.gates)) {
      errors.push({ field: `${path}.gates`, message: "must be an object" });
    } else {
      for (const [phaseName, gateRaw] of Object.entries(raw.gates as Record<string, RawGate>)) {
        const requires: string[] = [];
        if (Array.isArray(gateRaw?.requires)) {
          for (const r of gateRaw.requires) {
            if (typeof r === "string") requires.push(r);
          }
        }
        gates[phaseName] = { requires };
      }
    }
  }

  const workflow: Workflow = {
    phases,
    gates,
    ...(typeof raw.maxIterations === "number" ? { maxIterations: raw.maxIterations } : {}),
  };

  return { workflow, errors };
}

function mapCapability(raw: RawCapability, path: string): { capability: Capability; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }
  if (!raw.description || typeof raw.description !== "string") {
    errors.push({ field: `${path}.description`, message: "must be a non-empty string" });
  }

  const tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push({ field: `${path}.tags`, message: "must be an array" });
    } else {
      for (const t of raw.tags) {
        if (typeof t === "string") tags.push(t);
      }
    }
  }

  const capability: Capability = {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    schema: typeof raw.schema === "object" && raw.schema !== null && !Array.isArray(raw.schema)
      ? (raw.schema as Record<string, unknown>)
      : {},
    tags,
    ...(raw.annotations ? { annotations: raw.annotations as Capability["annotations"] } : {}),
    ...(typeof raw.type === "string" ? { type: raw.type } : {}),
    ...(typeof raw.targetApp === "string" ? { targetApp: raw.targetApp } : {}),
    ...(typeof raw.task === "string" ? { task: raw.task } : {}),
    ...(typeof raw.timeout === "number" && raw.timeout > 0 ? { timeout: raw.timeout } : {}),
  };

  if (raw.type === "delegation") {
    if (typeof raw.targetApp !== "string" || raw.targetApp === "") {
      errors.push({ field: `${path}.targetApp`, message: "required when type is 'delegation'" });
    }
    if (typeof raw.task !== "string" || raw.task === "") {
      errors.push({ field: `${path}.task`, message: "required when type is 'delegation'" });
    }
  }

  return { capability, errors };
}

function mapQualityGate(raw: RawQualityGate, path: string): { gate: QualityGate; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }
  if (!raw.command || typeof raw.command !== "string") {
    errors.push({ field: `${path}.command`, message: "must be a non-empty string" });
  }
  if (!raw.description || typeof raw.description !== "string") {
    errors.push({ field: `${path}.description`, message: "must be a non-empty string" });
  }

  const gate: QualityGate = {
    name: typeof raw.name === "string" ? raw.name : "",
    command: typeof raw.command === "string" ? raw.command : "",
    description: typeof raw.description === "string" ? raw.description : "",
    required: typeof raw.required === "boolean" ? raw.required : true,
  };

  return { gate, errors };
}

function mapTeam(name: string, raw: RawTeam, path: string): { team: Team; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];
  const agents: Record<string, Agent> = {};

  // Agents
  if (!raw.agents || typeof raw.agents !== "object" || Array.isArray(raw.agents)) {
    errors.push({ field: `${path}.agents`, message: "must be an object" });
  } else {
    for (const [agentName, agentRaw] of Object.entries(raw.agents as Record<string, RawAgent>)) {
      const { agent, errors: agentErrors } = mapAgent(agentName, agentRaw ?? {}, `${path}.agents.${agentName}`);
      agents[agentName] = agent;
      errors.push(...agentErrors);
    }
  }

  // Workflow
  let workflow: Workflow = { phases: [], gates: {} };
  if (!raw.workflow || typeof raw.workflow !== "object" || Array.isArray(raw.workflow)) {
    errors.push({ field: `${path}.workflow`, message: "must be an object" });
  } else {
    const { workflow: wf, errors: wfErrors } = mapWorkflow(raw.workflow as RawWorkflow, `${path}.workflow`);
    workflow = wf;
    errors.push(...wfErrors);
  }

  // Capabilities
  const capabilities: Capability[] = [];
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities)) {
      errors.push({ field: `${path}.capabilities`, message: "must be an array" });
    } else {
      for (let i = 0; i < raw.capabilities.length; i++) {
        const { capability, errors: capErrors } = mapCapability(
          raw.capabilities[i] as RawCapability,
          `${path}.capabilities[${i}]`,
        );
        capabilities.push(capability);
        errors.push(...capErrors);
      }
    }
  }

  // Quality gates -- support both `qualityGates` and `quality` keys
  const qualityGates: QualityGate[] = [];
  const rawGates = raw.qualityGates ?? raw.quality;
  if (rawGates !== undefined) {
    if (!Array.isArray(rawGates)) {
      errors.push({ field: `${path}.qualityGates`, message: "must be an array" });
    } else {
      for (let i = 0; i < rawGates.length; i++) {
        const { gate, errors: gateErrors } = mapQualityGate(
          rawGates[i] as RawQualityGate,
          `${path}.qualityGates[${i}]`,
        );
        qualityGates.push(gate);
        errors.push(...gateErrors);
      }
    }
  }

  const team: Team = { name, agents, workflow, capabilities, qualityGates };
  return { team, errors };
}

function mapRouter(raw: RawRouter, path: string): { router: Router; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const rules: PatternRule[] = [];
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) {
      errors.push({ field: `${path}.rules`, message: "must be an array" });
    } else {
      for (let i = 0; i < raw.rules.length; i++) {
        const ruleRaw = raw.rules[i] as RawRule;
        if (!ruleRaw.match || typeof ruleRaw.match !== "string") {
          errors.push({ field: `${path}.rules[${i}].match`, message: "must be a non-empty string" });
        }
        if (!ruleRaw.team || typeof ruleRaw.team !== "string") {
          errors.push({ field: `${path}.rules[${i}].team`, message: "must be a non-empty string" });
        }
        rules.push({
          match: typeof ruleRaw.match === "string" ? ruleRaw.match : "",
          team: typeof ruleRaw.team === "string" ? ruleRaw.team : "",
        });
      }
    }
  }

  if (!raw.fallback || typeof raw.fallback !== "string") {
    errors.push({ field: `${path}.fallback`, message: "must be a non-empty string" });
  }

  let classifier: Agent | undefined;
  if (raw.classifier !== undefined) {
    const classifierRaw = raw.classifier as RawAgent;
    const { agent, errors: classifierErrors } = mapAgent(
      "classifier",
      { ...classifierRaw, tier: classifierRaw.tier ?? "fast" },
      `${path}.classifier`,
    );
    classifier = agent;
    errors.push(...classifierErrors);
  }

  const router: Router = {
    rules,
    fallback: typeof raw.fallback === "string" ? raw.fallback : "",
    ...(classifier ? { classifier } : {}),
  };

  return { router, errors };
}

function mapMemory(raw: RawMemory, path: string): { memory: MemoryConfig; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const scopes: MemoryScope[] = [];
  if (!raw.scopes || !Array.isArray(raw.scopes)) {
    errors.push({ field: `${path}.scopes`, message: "must be a non-empty array" });
  } else {
    for (const s of raw.scopes) {
      if (typeof s === "string") scopes.push(s as MemoryScope);
    }
  }

  if (!raw.backend || typeof raw.backend !== "string") {
    errors.push({ field: `${path}.backend`, message: "must be a non-empty string" });
  }

  const memory: MemoryConfig = {
    scopes,
    backend: typeof raw.backend === "string" ? raw.backend : "",
    ...(typeof raw.sync === "string" ? { sync: raw.sync } : {}),
  };

  return { memory, errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a YAML string into a typed App composite. Throws AppLoaderError if invalid. */
export function parseAppYaml(content: string): App {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new AppLoaderError([{ field: "yaml", message: String(err) }]);
  }

  const errors: { field: string; message: string }[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AppLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawApp;

  // name
  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  // channels
  const channels: string[] = [];
  if (raw.channels !== undefined) {
    if (!Array.isArray(raw.channels)) {
      errors.push({ field: "channels", message: "must be an array" });
    } else {
      for (const c of raw.channels) {
        if (typeof c === "string") channels.push(c);
      }
    }
  }

  // memory
  let memory: MemoryConfig = { scopes: [], backend: "" };
  if (!raw.memory || typeof raw.memory !== "object" || Array.isArray(raw.memory)) {
    errors.push({ field: "memory", message: "must be an object" });
  } else {
    const { memory: mem, errors: memErrors } = mapMemory(raw.memory as RawMemory, "memory");
    memory = mem;
    errors.push(...memErrors);
  }

  // teams
  const teams: Record<string, Team> = {};
  if (!raw.teams || typeof raw.teams !== "object" || Array.isArray(raw.teams)) {
    errors.push({ field: "teams", message: "must be an object" });
  } else {
    for (const [teamName, teamRaw] of Object.entries(raw.teams as Record<string, RawTeam>)) {
      const { team, errors: teamErrors } = mapTeam(teamName, teamRaw ?? {}, `teams.${teamName}`);
      teams[teamName] = team;
      errors.push(...teamErrors);
    }
  }

  // router
  let router: Router = { rules: [], fallback: "" };
  if (!raw.router || typeof raw.router !== "object" || Array.isArray(raw.router)) {
    errors.push({ field: "router", message: "must be an object" });
  } else {
    const { router: rt, errors: routerErrors } = mapRouter(raw.router as RawRouter, "router");
    router = rt;
    errors.push(...routerErrors);
  }

  if (errors.length > 0) throw new AppLoaderError(errors);

  return {
    name: raw.name as string,
    teams,
    router,
    memory,
    channels,
  };
}

/** Validate the dependency graph of an App. Returns null if valid, AppLoaderError if not. */
export function validateAppGraph(app: App): AppLoaderError | null {
  const appErrors = validateApp(app);
  if (appErrors.length === 0) return null;
  return new AppLoaderError(appErrors);
}
