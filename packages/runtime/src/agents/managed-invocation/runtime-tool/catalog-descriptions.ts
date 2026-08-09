// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Markdown/description builders for tool schemas plus the small schema
// helpers they share.
import type { ManagedAgentAuthorityProfile, ManagedAgentRouteSource, ModelTaskSuitability } from "@kilnai/core";
import type {
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationRouteProfile,
  ManagedInvocationToolInput,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
  ManagedInvocationUnavailableRoute,
} from "./types.js";
import { readRecord } from "./input-parsing.js";

export function buildManagedRouteCatalogDescription(options: ManagedInvocationToolOptions): string {
  const healthy = options.routes.length > 0
    ? options.routes
        .map((route) => {
          const suitability = formatTaskSuitability(route.taskSuitability, managedInvocationSkillNames(options));
          const timeoutSummary = formatRouteTimeoutSummary(route.profiles);
          return `- ${route.routeId}: routeSource=${route.routeSource}, providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, surface=${route.surface ?? "configured"}, profiles=${Object.keys(route.profiles).join(",")}${timeoutSummary ? `, ${timeoutSummary}` : ""}${suitability ? `, taskSuitability=${suitability}` : ""}`;
        })
        .join("\n")
    : "- none";
  const unavailable = options.unavailableRoutes && options.unavailableRoutes.length > 0
    ? options.unavailableRoutes
        .map((route) => `- ${route.routeId}: routeSource=${route.routeSource}, providerRoute.providerId=${route.providerId}${route.model ? `, model=${route.model}` : ""}, profiles=${route.profiles.join(",")}, reason=${route.reason}`)
        .join("\n")
    : "- none";
  return [
    "Configured healthy managed invocation routes:",
    healthy,
    "Configured unavailable managed invocation routes:",
    unavailable,
  ].join("\n");
}

export function formatRouteTimeoutSummary(
  profiles: ManagedInvocationToolRoute["profiles"],
): string | undefined {
  const entries = Object.entries(profiles)
    .map(([profile, value]) => ({
      profile,
      timeoutMs: value?.timeoutMs,
      ...(value?.timeoutSource ? { timeoutSource: value.timeoutSource } : {}),
    }))
    .filter((entry): entry is {
      readonly profile: string;
      readonly timeoutMs: number;
      readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
    } =>
      typeof entry.timeoutMs === "number" && Number.isFinite(entry.timeoutMs)
    );
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return formatRouteTimeoutEntry(entries[0]!);
  }
  return `timeouts=${entries.map((entry) => `${entry.profile}:${formatRouteTimeoutEntry(entry)}`).join("|")}`;
}

export function formatRouteTimeoutEntry(entry: {
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
}): string {
  return entry.timeoutSource
    ? `timeoutMs=${entry.timeoutMs} source=${entry.timeoutSource}`
    : `timeoutMs=${entry.timeoutMs}`;
}

export function managedInvocationRouteHealthReason(profile: ManagedInvocationRouteProfile, routeSource: ManagedAgentRouteSource): string {
  return profile.timeoutSource
    ? `Configured managed invocation route selected by runtime tool; routeSource=${routeSource}; effective timeoutMs=${profile.timeoutMs} source=${profile.timeoutSource}.`
    : `Configured managed invocation route selected by runtime tool; routeSource=${routeSource}; effective timeoutMs=${profile.timeoutMs}.`;
}

export function formatTaskSuitability(
  suitability: readonly ModelTaskSuitability[] | undefined,
  configuredSkills: readonly string[],
): string | undefined {
  if (!suitability || suitability.length === 0) {
    return undefined;
  }
  const configuredSkillSet = new Set(configuredSkills);
  return suitability
    .map((entry) => {
      const evidence = entry.evidence && entry.evidence.length > 0
        ? `:evidence=${unique(entry.evidence.map((item) => item.source)).join("+")}`
        : "";
      const recommendedSkills = (entry.recommendedSkills ?? []).filter((skill) => configuredSkillSet.has(skill));
      const skills = recommendedSkills.length > 0 ? `:skills=${recommendedSkills.join("+")}` : "";
      return `${entry.task}:${entry.level}:${entry.source}${evidence}${skills}`;
    })
    .join(";");
}

export function buildManagedAgentSelectionDescription(options: ManagedInvocationToolOptions): string {
  const catalog = options.agentCatalog ?? [];
  const agents = catalog.length > 0
    ? catalog.map((agent) => {
        const aliases = [
          ...(agent.displayName ? [agent.displayName] : []),
          ...(agent.nicknameCandidates ?? []),
        ];
        const routeHint = agent.routeId
          ? `, routeId=${agent.routeId}`
          : agent.providerRoute
            ? `, providerRoute.providerId=${agent.providerRoute.providerId}${agent.providerRoute.model ? `, model=${agent.providerRoute.model}` : ""}`
            : "";
        const skills = agent.skills && agent.skills.length > 0 ? `, skills=${agent.skills.join(",")}` : "";
        return `- ${agent.name}${aliases.length > 0 ? ` (${aliases.join("/")})` : ""}: role=${agent.role}, goal=${agent.goal}, tier=${agent.tier}${skills}${routeHint}`;
      }).join("\n")
    : "- none";
  return [
    "Configured admitted agent profiles:",
    agents,
    `Configured admitted skills: ${formatBoundedList(managedInvocationSkillNames(options), 24)}`,
    buildManagedSkillCatalogDescription(options),
    buildManagedTaskAffinityDescription(options),
    "Selection policy:",
    "- Use scout/context profiles before broad or ambiguous implementation.",
    "- Follow routeId/providerRoute hints shown on the selected agent profile.",
    "- Use tdd/test profiles before behavior-changing work.",
    "- Use coding profiles for bounded implementation subtasks.",
    "- Use reviewer/validator profiles for quality gates, architecture checks, and risk review.",
    "- Use researcher profiles for external or evidence-dependent questions.",
    "- Omit agentProfile for one-off generic read-only child tasks that do not match a configured profile.",
  ].join("\n");
}

export function buildManagedSkillCatalogDescription(options: ManagedInvocationToolOptions): string {
  const skillCatalog = options.skillCatalog ?? [];
  if (skillCatalog.length === 0) {
    return "Configured skill catalog: none";
  }
  const configured = skillCatalog.filter((skill) =>
    skill.configured !== false && skill.admission?.state !== "unavailable"
  );
  const diagnostics = skillCatalog.filter((skill) =>
    skill.configured === false || skill.admission?.state === "unavailable"
  );
  const rows = configured.slice(0, 24).map((skill) => {
    const tags = skill.tags && skill.tags.length > 0 ? `, tags=${skill.tags.join(",")}` : "";
    const origin = skill.origin ? `, origin=${skill.origin}` : "";
    const admission = skill.admission ? `, admission=${skill.admission.state}` : "";
    const projection = skill.projections && skill.projections.length > 0
      ? `, projections=${skill.projections.map((entry) => `${entry.target}:${entry.status}`).join(",")}`
      : "";
    const omitted = skill.omissionReason ? `, omission=${skill.omissionReason}` : "";
    return `- ${skill.name}: ${skill.description}${origin}${admission}${projection}${omitted}${tags}`;
  });
  const omittedConfigured = configured.length - rows.length;
  if (omittedConfigured > 0) {
    rows.push(`- ${omittedConfigured} additional configured skill(s) omitted from this bounded catalog summary.`);
  }
  if (diagnostics.length > 0) {
    const byReason = new Map<string, number>();
    for (const skill of diagnostics) {
      const reason = skill.omissionReason ?? skill.admission?.state ?? "diagnostic";
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    rows.push(
      `- Diagnostic-only native skill entries: ${diagnostics.length} (${[...byReason.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ")}).`,
    );
  }
  return ["Configured skill catalog summary:", ...rows].join("\n");
}

export function buildManagedTaskAffinityDescription(options: ManagedInvocationToolOptions): string {
  const routeRows = managedRouteTaskAffinityRows(options.routes);
  const agentRows = managedAgentTaskAffinityRows(options.agentCatalog ?? []);
  return [
    "Task-affinity hints:",
    routeRows.length > 0 ? `Routes: ${routeRows.join("; ")}` : "Routes: no task suitability evidence",
    agentRows.length > 0 ? `Agent profiles: ${agentRows.join("; ")}` : "Agent profiles: no configured agent profiles",
    "Skills: request a skill only when its name appears in the configured Kiln skill catalog or on the selected agent profile. Harness-local native skills marked unmanaged-native are diagnostics only and are not admissible.",
  ].join("\n");
}

export function managedInvocationAgentProfileNames(options: ManagedInvocationToolOptions): readonly string[] {
  return unique((options.agentCatalog ?? []).flatMap((agent) => [
    agent.name,
    ...(agent.displayName ? [agent.displayName] : []),
    ...(agent.nicknameCandidates ?? []),
  ]));
}

export function managedInvocationSkillNames(options: ManagedInvocationToolOptions): readonly string[] {
  return unique([
    ...(options.skillCatalog ?? [])
      .filter((skill) => skill.configured !== false && skill.admission?.state !== "unavailable")
      .map((skill) => skill.name),
    ...(options.agentCatalog ?? []).flatMap((agent) => agent.skills ?? []),
  ]);
}

function managedRouteTaskAffinityRows(routes: readonly ManagedInvocationToolRoute[]): readonly string[] {
  return routes.flatMap((route) => {
    const suitability = route.taskSuitability ?? [];
    const preferredOrCapable = suitability.filter((entry) => entry.level === "preferred" || entry.level === "capable");
    if (preferredOrCapable.length === 0) {
      return [];
    }
    return [`${route.routeId} -> ${preferredOrCapable.map((entry) => `${entry.task}:${entry.level}`).join(",")}`];
  });
}

function managedAgentTaskAffinityRows(agents: readonly ManagedInvocationAgentCatalogEntry[]): readonly string[] {
  return agents.flatMap((agent) => {
    const tasks = agent.taskAffinity ?? [];
    return tasks.length > 0 ? [`${agent.name} -> ${tasks.join(",")}`] : [];
  });
}

export function managedAgentDisplayName(
  options: ManagedInvocationToolOptions,
  profile: string | undefined,
): string | undefined {
  if (!profile) {
    return undefined;
  }
  const entry = (options.agentCatalog ?? []).find((agent) =>
    agent.name === profile
    || agent.displayName === profile
    || (agent.nicknameCandidates ?? []).includes(profile)
  );
  return entry?.displayName ?? entry?.name;
}

export function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function formatBoundedList(values: readonly string[], limit: number): string {
  if (values.length === 0) {
    return "none";
  }
  const visible = values.slice(0, limit).join(", ");
  const omitted = values.length - limit;
  return omitted > 0 ? `${visible}, ... (${omitted} more)` : visible;
}

export function cloneToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

export function readSchemaProperties(value: unknown): Record<string, unknown> {
  const record = readRecord(value);
  const properties = readRecord(record?.properties);
  return properties ?? {};
}

export function readSchemaProperty(value: unknown): Record<string, unknown> | undefined {
  return readRecord(value);
}

export function resolveUnavailableRoute(
  routes: readonly ManagedInvocationUnavailableRoute[],
  input: ManagedInvocationToolInput,
): ManagedInvocationUnavailableRoute | undefined {
  return routes.find((route) =>
    route.providerId === input.providerRoute.providerId
    && (!input.routeId || route.routeId === input.routeId)
    && (!input.providerRoute.model || route.model === input.providerRoute.model)
    && route.profiles.includes(input.profile)
  );
}
