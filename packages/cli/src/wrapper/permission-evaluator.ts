import { normalizePermissionPolicy } from "./permission-normalizer.js";
import { canonicalToolName } from "./tool-vocabulary.js";
import type {
  KilnAgentPermissionScope,
  KilnCommandPermissionRule,
  KilnMemoryAuthorityCaller,
  KilnMemoryAuthorityPolicy,
  KilnMemoryAuthorityPolicyRule,
  KilnFileGovernancePolicy,
  KilnMemoryAuthorityRule,
  KilnMemoryPermissionPolicy,
  KilnPermissionAction,
  KilnPermissionApproval,
  KilnPermissionPolicy,
  KilnToolPermissionRule,
} from "./session.js";

type NormalizedPermissionPolicy = ReturnType<typeof normalizePermissionPolicy>;

export interface PermissionScopeInfo {
  readonly agent?: string;
  readonly matchedScope: boolean;
  readonly inherit: boolean;
  readonly mcpTools?: readonly string[];
}

export type PermissionDecisionSource =
  | "tool-rule"
  | "command-rule"
  | "file-governance.deny"
  | "file-governance.ask"
  | "file-governance.allow"
  | "data-firewall"
  | "default";

export interface PermissionDecisionMatch {
  readonly source: PermissionDecisionSource;
  readonly key: string;
  readonly reason?: string;
  readonly rule: unknown;
}

export interface PermissionDecision {
  readonly action: KilnPermissionAction;
  readonly source: PermissionDecisionSource;
  readonly scope: PermissionScopeInfo;
  readonly match?: PermissionDecisionMatch;
  readonly dataFirewallAction?: "allow" | "redact" | "deny";
}

export type PermissionEvaluationRequest =
  | {
      readonly kind: "tool";
      readonly tool: string;
    }
  | {
      readonly kind: "command";
      readonly command: string;
      readonly shell?: "bash" | "sh" | "zsh" | "any";
    }
  | {
      readonly kind: "file";
      readonly filePath: string;
    }
  | {
      readonly kind: "destination";
      readonly destination: string;
      readonly classifications?: readonly string[];
    };

export interface PermissionEvaluator {
  readonly scope: PermissionScopeInfo;
  readonly effectivePolicy: NormalizedPermissionPolicy;
  evaluate(request: PermissionEvaluationRequest): PermissionDecision;
  evaluateTool(tool: string): PermissionDecision;
  evaluateCommand(command: string, shell?: "bash" | "sh" | "zsh" | "any"): PermissionDecision;
  evaluateFile(filePath: string): PermissionDecision;
  evaluateDestination(destination: string, classifications?: readonly string[]): PermissionDecision;
}

export interface EffectivePermissionPolicyResult {
  readonly policy: NormalizedPermissionPolicy;
  readonly scope: PermissionScopeInfo;
  /**
   * Agent scopes are a child authority. Keep the layers available to the
   * evaluator so root last-match semantics do not turn a child rule into a
   * re-grant. The composed policy remains available to callers that project
   * memory authority.
   */
  readonly parentPolicy?: NormalizedPermissionPolicy;
  readonly scopedPolicy?: NormalizedPermissionPolicy;
}

export const AGENT_SCOPE_INHERIT_FALSE_ERROR =
  "Permission agent scope inherit:false is unsupported; agent scopes may only narrow their parent.";

export function resolveEffectivePermissionPolicy(
  policy: KilnPermissionPolicy,
  agent?: string,
): EffectivePermissionPolicyResult {
  const normalizedRoot = normalizePermissionPolicy(policy);
  if (!agent) {
    return {
      policy: normalizedRoot,
      scope: { matchedScope: false, inherit: true },
    };
  }

  const matchedScope = findAgentScope(normalizedRoot.agentScopes, agent);
  if (!matchedScope) {
    return {
      policy: normalizedRoot,
      scope: { agent, matchedScope: false, inherit: true },
    };
  }

  const inherit = matchedScope.inherit ?? true;
  if (!inherit) {
    throw new TypeError(AGENT_SCOPE_INHERIT_FALSE_ERROR);
  }

  const basePolicy: KilnPermissionPolicy = normalizedRoot;
  const scopedLayerPolicy = normalizePermissionPolicy({
    approval: normalizedRoot.approval,
    sandbox: normalizedRoot.sandbox,
    tools: matchedScope.tools,
    commands: matchedScope.commands,
    fileGovernance: matchedScope.fileGovernance,
  });

  const scopedPolicy: KilnPermissionPolicy = {
    ...basePolicy,
    tools: mergeToolRules(basePolicy.tools, matchedScope.tools),
    commands: mergeCommandRules(basePolicy.commands, matchedScope.commands),
    fileGovernance: mergeFileGovernance(basePolicy.fileGovernance, matchedScope.fileGovernance),
    memory: intersectMemoryPolicy(basePolicy.memory, matchedScope.memory),
    dataFirewall: basePolicy.dataFirewall,
    agentScopes: [],
  };

  return {
    policy: normalizePermissionPolicy(scopedPolicy),
    scope: {
      agent,
      matchedScope: true,
      inherit,
      mcpTools: matchedScope.mcpTools,
    },
    parentPolicy: normalizedRoot,
    scopedPolicy: scopedLayerPolicy,
  };
}

export function convertEffectiveMemoryPermissionPolicyToMemoryAuthorityPolicy(
  effectivePolicy: NormalizedPermissionPolicy,
  caller: KilnMemoryAuthorityCaller,
): KilnMemoryAuthorityPolicy {
  const rules: KilnMemoryAuthorityPolicyRule[] = [
    ...effectivePolicy.memory.read.map((rule) => toCoreMemoryAuthorityRule("read", rule)),
    ...effectivePolicy.memory.write.map((rule) => toCoreMemoryAuthorityRule("write", rule)),
  ];

  return {
    caller,
    rules,
  };
}

export function createPermissionEvaluator(
  policy: KilnPermissionPolicy,
  options?: { readonly agent?: string },
): PermissionEvaluator {
  const effective = resolveEffectivePermissionPolicy(policy, options?.agent);

  return {
    scope: effective.scope,
    effectivePolicy: effective.policy,
    evaluate(request: PermissionEvaluationRequest): PermissionDecision {
      switch (request.kind) {
        case "tool":
          return evaluateToolRule(effective.policy, effective.scope, request.tool, effective);
        case "command":
          return evaluateCommandRule(
            effective.policy,
            effective.scope,
            request.command,
            request.shell ?? "any",
            effective,
          );
        case "file":
          return evaluateFileGovernanceRule(effective.policy, effective.scope, request.filePath, effective);
        case "destination":
          return evaluateDataFirewallRule(
            effective.policy,
            effective.scope,
            request.destination,
            request.classifications ?? [],
          );
      }
    },
    evaluateTool(tool: string): PermissionDecision {
      return evaluateToolRule(effective.policy, effective.scope, tool, effective);
    },
    evaluateCommand(command: string, shell: "bash" | "sh" | "zsh" | "any" = "any"): PermissionDecision {
      return evaluateCommandRule(effective.policy, effective.scope, command, shell, effective);
    },
    evaluateFile(filePath: string): PermissionDecision {
      return evaluateFileGovernanceRule(effective.policy, effective.scope, filePath, effective);
    },
    evaluateDestination(destination: string, classifications: readonly string[] = []): PermissionDecision {
      return evaluateDataFirewallRule(effective.policy, effective.scope, destination, classifications);
    },
  };
}

function evaluateToolRule(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  tool: string,
  layers?: EffectivePermissionPolicyResult,
): PermissionDecision {
  if (layers?.parentPolicy && layers.scopedPolicy) {
    return meetPermissionDecisions(
      evaluateToolRuleForLayer(layers.parentPolicy, scope, tool, true),
      evaluateToolRuleForLayer(layers.scopedPolicy, scope, tool, false),
    );
  }
  return evaluateToolRuleForLayer(policy, scope, tool, true)!;
}

function evaluateToolRuleForLayer(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  tool: string,
  defaultWhenUnmatched: boolean,
): PermissionDecision | undefined {
  const canonicalTool = canonicalToolName(tool);
  const matched = findLastMatch(policy.tools, (rule) =>
    matchesPattern(canonicalTool, canonicalToolName(rule.tool)),
  );
  if (!matched) {
    if (!defaultWhenUnmatched) return undefined;
    return {
      action: defaultAction(policy.approval),
      source: "default",
      scope,
    };
  }

  return {
    action: matched.rule.action,
    source: "tool-rule",
    scope,
    match: {
      source: "tool-rule",
      key: matched.rule.tool,
      reason: matched.rule.reason,
      rule: matched.rule,
    },
  };
}

function evaluateCommandRule(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  command: string,
  shell: "bash" | "sh" | "zsh" | "any",
  layers?: EffectivePermissionPolicyResult,
): PermissionDecision {
  if (layers?.parentPolicy && layers.scopedPolicy) {
    return meetPermissionDecisions(
      evaluateCommandRuleForLayer(layers.parentPolicy, scope, command, shell, true),
      evaluateCommandRuleForLayer(layers.scopedPolicy, scope, command, shell, false),
    );
  }
  return evaluateCommandRuleForLayer(policy, scope, command, shell, true)!;
}

function evaluateCommandRuleForLayer(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  command: string,
  shell: "bash" | "sh" | "zsh" | "any",
  defaultWhenUnmatched: boolean,
): PermissionDecision | undefined {
  const matched = findLastMatch(policy.commands, (rule) => {
    if (rule.shell && rule.shell !== "any" && rule.shell !== shell) {
      return false;
    }
    return matchesPattern(command, rule.pattern);
  });
  if (!matched) {
    if (!defaultWhenUnmatched) return undefined;
    return {
      action: defaultAction(policy.approval),
      source: "default",
      scope,
    };
  }

  return {
    action: matched.rule.action,
    source: "command-rule",
    scope,
    match: {
      source: "command-rule",
      key: matched.rule.pattern,
      reason: matched.rule.reason,
      rule: matched.rule,
    },
  };
}

function evaluateFileGovernanceRule(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  filePath: string,
  layers?: EffectivePermissionPolicyResult,
): PermissionDecision {
  if (layers?.parentPolicy && layers.scopedPolicy) {
    return meetPermissionDecisions(
      evaluateFileGovernanceRuleForLayer(layers.parentPolicy, scope, filePath, true),
      evaluateFileGovernanceRuleForLayer(layers.scopedPolicy, scope, filePath, false),
    );
  }
  return evaluateFileGovernanceRuleForLayer(policy, scope, filePath, true)!;
}

function evaluateFileGovernanceRuleForLayer(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  filePath: string,
  defaultWhenUnmatched: boolean,
): PermissionDecision | undefined {
  const normalizedPath = normalizePath(filePath);

  const denyMatch = findLastGlobMatch(policy.fileGovernance.denyGlobs ?? [], normalizedPath);
  if (denyMatch) {
    return {
      action: "deny",
      source: "file-governance.deny",
      scope,
      match: {
        source: "file-governance.deny",
        key: denyMatch,
        rule: denyMatch,
      },
    };
  }

  const askMatch = findLastGlobMatch(policy.fileGovernance.askGlobs ?? [], normalizedPath);
  if (askMatch) {
    return {
      action: "ask",
      source: "file-governance.ask",
      scope,
      match: {
        source: "file-governance.ask",
        key: askMatch,
        rule: askMatch,
      },
    };
  }

  const allowMatch = findLastGlobMatch(policy.fileGovernance.allowGlobs ?? [], normalizedPath);
  if (allowMatch) {
    return {
      action: "allow",
      source: "file-governance.allow",
      scope,
      match: {
        source: "file-governance.allow",
        key: allowMatch,
        rule: allowMatch,
      },
    };
  }

  if (!defaultWhenUnmatched) return undefined;
  return {
    action: defaultAction(policy.approval),
    source: "default",
    scope,
  };
}

function evaluateDataFirewallRule(
  policy: NormalizedPermissionPolicy,
  scope: PermissionScopeInfo,
  destination: string,
  classifications: readonly string[],
): PermissionDecision {
  const normalizedClassifications = new Set(classifications.map((value) => value.toLowerCase()));
  const matched = findLastMatch(policy.dataFirewall, (rule) => {
    if (!matchesPattern(destination, rule.destination)) {
      return false;
    }
    if (!rule.classifications || rule.classifications.length === 0) {
      return true;
    }
    return rule.classifications.some((classification) => {
      return normalizedClassifications.has(classification.toLowerCase());
    });
  });

  if (!matched) {
    return {
      action: "deny",
      source: "default",
      scope,
      dataFirewallAction: "deny",
    };
  }

  return {
    action: matched.rule.action === "deny" ? "deny" : "allow",
    source: "data-firewall",
    scope,
    dataFirewallAction: matched.rule.action,
    match: {
      source: "data-firewall",
      key: matched.rule.destination,
      reason: matched.rule.reason,
      rule: matched.rule,
    },
  };
}

function meetPermissionDecisions(
  parent: PermissionDecision | undefined,
  scoped: PermissionDecision | undefined,
): PermissionDecision {
  if (!parent && !scoped) {
    throw new Error("Permission evaluator layers must provide a parent decision.");
  }
  if (!parent) return scoped!;
  if (!scoped) return parent;

  const rank: Record<KilnPermissionAction, number> = {
    allow: 0,
    ask: 1,
    deny: 2,
  };
  return rank[parent.action] >= rank[scoped.action] ? parent : scoped;
}

function mergeToolRules(
  base: readonly KilnToolPermissionRule[] | undefined,
  scoped: readonly KilnToolPermissionRule[] | undefined,
): readonly KilnToolPermissionRule[] {
  if (!scoped || scoped.length === 0) {
    return base ?? [];
  }
  // The flattened policy is also consumed by projections. Never expose a
  // child allow as though it were a root grant. A child ask is represented as
  // deny here because the flat form has no parent-layer meet semantics.
  return [
    ...(base ?? []),
    ...scoped
      .filter((rule) => rule.action !== "allow")
      .map((rule) => rule.action === "ask" ? { ...rule, action: "deny" as const } : rule),
  ];
}

function mergeCommandRules(
  base: readonly KilnCommandPermissionRule[] | undefined,
  scoped: readonly KilnCommandPermissionRule[] | undefined,
): readonly KilnCommandPermissionRule[] {
  if (!scoped || scoped.length === 0) {
    return base ?? [];
  }
  return [
    ...(base ?? []),
    ...scoped
      .filter((rule) => rule.action !== "allow")
      .map((rule) => rule.action === "ask" ? { ...rule, action: "deny" as const } : rule),
  ];
}

function mergeFileGovernance(
  base: KilnFileGovernancePolicy | undefined,
  scoped: KilnFileGovernancePolicy | undefined,
): KilnFileGovernancePolicy {
  if (!scoped) {
    return base ?? {};
  }

  return {
    excludeFromContext: (base?.excludeFromContext === true || scoped.excludeFromContext === true)
      ? true
      : scoped.excludeFromContext ?? base?.excludeFromContext,
    denyGlobs: deduplicateStrings([...(base?.denyGlobs ?? []), ...(scoped.denyGlobs ?? [])]),
    askGlobs: deduplicateStrings([...(base?.askGlobs ?? []), ...(scoped.askGlobs ?? [])]),
    // A child allow is omitted from the flattened projection. The evaluator
    // still meets the independent child layer with its parent at call time.
    allowGlobs: deduplicateStrings([...(base?.allowGlobs ?? [])]),
  };
}

function intersectMemoryPolicy(
  base: KilnMemoryPermissionPolicy | undefined,
  scoped: KilnMemoryPermissionPolicy | undefined,
): KilnMemoryPermissionPolicy {
  if (!scoped) {
    return base ?? {};
  }
  return {
    read: intersectMemoryRules(base?.read ?? [], scoped.read ?? []),
    write: intersectMemoryRules(base?.write ?? [], scoped.write ?? []),
  };
}

/** Memory rules are grants; an agent retains only an exact parent grant. */
function intersectMemoryRules(
  parent: readonly KilnMemoryAuthorityRule[],
  scoped: readonly KilnMemoryAuthorityRule[],
): KilnMemoryAuthorityRule[] {
  const parentKeys = new Set(parent.map(memoryRuleKey));
  return deduplicateMemoryRules(scoped.filter((rule) => parentKeys.has(memoryRuleKey(rule))));
}

function deduplicateStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function deduplicateMemoryRules(values: readonly KilnMemoryAuthorityRule[]): KilnMemoryAuthorityRule[] {
  const seen = new Map<string, number>();
  values.forEach((rule, index) => {
    seen.set(memoryRuleKey(rule), index);
  });
  return values.filter((rule, index) => seen.get(memoryRuleKey(rule)) === index);
}

function memoryRuleKey(rule: KilnMemoryAuthorityRule): string {
  return [
    rule.operations.join(","),
    (rule.scopeKinds ?? []).join(","),
    (rule.scopeIds ?? []).join(","),
    (rule.layers ?? []).join(","),
    rule.allowAuditWrite === true ? "audit:allow" : "audit:default",
  ].join("|");
}

function toCoreMemoryAuthorityRule(
  access: "read" | "write",
  rule: KilnMemoryAuthorityRule,
): KilnMemoryAuthorityPolicyRule {
  return {
    access,
    operations: [...rule.operations],
    ...(rule.scopeKinds ? { scopeKinds: [...rule.scopeKinds] } : {}),
    ...(rule.scopeIds ? { scopeIds: [...rule.scopeIds] } : {}),
    ...(rule.layers ? { layers: [...rule.layers] } : {}),
    ...(access === "write" && rule.allowAuditWrite !== undefined
      ? { allowAuditWrite: rule.allowAuditWrite }
      : {}),
  };
}

function findAgentScope(
  scopes: readonly KilnAgentPermissionScope[],
  agent: string,
): KilnAgentPermissionScope | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope) continue;
    if (scope.agent === agent) {
      return scope;
    }
  }
  return undefined;
}

function findLastGlobMatch(globs: readonly string[], value: string): string | undefined {
  for (let i = globs.length - 1; i >= 0; i--) {
    const glob = globs[i];
    if (!glob) continue;
    if (matchesGlob(value, glob)) {
      return glob;
    }
  }
  return undefined;
}

function findLastMatch<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): { readonly index: number; readonly rule: T } | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value === undefined) continue;
    if (predicate(value)) {
      return { index: i, rule: value };
    }
  }
  return undefined;
}

function defaultAction(approval: KilnPermissionApproval | undefined): KilnPermissionAction {
  const effectiveApproval = approval ?? "on-request";
  if (effectiveApproval === "never") return "allow";
  if (effectiveApproval === "on-failure") return "allow";
  if (effectiveApproval === "untrusted") return "deny";
  return "ask";
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = normalizePath(value);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return normalizedValue === normalizedPattern;
  }
  return matchesGlob(normalizedValue, normalizedPattern);
}

function matchesGlob(value: string, glob: string): boolean {
  const pattern = globToRegExp(glob);
  return pattern.test(value);
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withDoubleStarToken = escaped.replace(/\*\*/g, "__DOUBLE_STAR__");
  const withSingleStars = withDoubleStarToken.replace(/\*/g, "[^/]*");
  const withQuestionMarks = withSingleStars.replace(/\?/g, "[^/]");
  const finalPattern = withQuestionMarks.replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${finalPattern}$`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
