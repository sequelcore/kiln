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
}

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
  const basePolicy: KilnPermissionPolicy = inherit
    ? normalizedRoot
    : {
        approval: normalizedRoot.approval,
        sandbox: normalizedRoot.sandbox,
        safeDefaults: false,
        auditLog: normalizedRoot.auditLog,
      };

  const scopedPolicy: KilnPermissionPolicy = {
    ...basePolicy,
    tools: mergeToolRules(basePolicy.tools, matchedScope.tools, inherit),
    commands: mergeCommandRules(basePolicy.commands, matchedScope.commands, inherit),
    fileGovernance: mergeFileGovernance(basePolicy.fileGovernance, matchedScope.fileGovernance, inherit),
    memory: mergeMemoryPolicy(basePolicy.memory, matchedScope.memory, inherit),
    dataFirewall: inherit ? basePolicy.dataFirewall : [],
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
          return evaluateToolRule(effective.policy, effective.scope, request.tool);
        case "command":
          return evaluateCommandRule(
            effective.policy,
            effective.scope,
            request.command,
            request.shell ?? "any",
          );
        case "file":
          return evaluateFileGovernanceRule(effective.policy, effective.scope, request.filePath);
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
      return evaluateToolRule(effective.policy, effective.scope, tool);
    },
    evaluateCommand(command: string, shell: "bash" | "sh" | "zsh" | "any" = "any"): PermissionDecision {
      return evaluateCommandRule(effective.policy, effective.scope, command, shell);
    },
    evaluateFile(filePath: string): PermissionDecision {
      return evaluateFileGovernanceRule(effective.policy, effective.scope, filePath);
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
): PermissionDecision {
  const canonicalTool = canonicalToolName(tool);
  const matched = findLastMatch(policy.tools, (rule) =>
    matchesPattern(canonicalTool, canonicalToolName(rule.tool)),
  );
  if (!matched) {
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
): PermissionDecision {
  const matched = findLastMatch(policy.commands, (rule) => {
    if (rule.shell && rule.shell !== "any" && rule.shell !== shell) {
      return false;
    }
    return matchesPattern(command, rule.pattern);
  });
  if (!matched) {
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
): PermissionDecision {
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
      action: "allow",
      source: "default",
      scope,
      dataFirewallAction: "allow",
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

function mergeToolRules(
  base: readonly KilnToolPermissionRule[] | undefined,
  scoped: readonly KilnToolPermissionRule[] | undefined,
  inherit: boolean,
): readonly KilnToolPermissionRule[] {
  if (!scoped || scoped.length === 0) {
    return inherit ? (base ?? []) : [];
  }
  if (!inherit) {
    return [...scoped];
  }
  return [...(base ?? []), ...scoped];
}

function mergeCommandRules(
  base: readonly KilnCommandPermissionRule[] | undefined,
  scoped: readonly KilnCommandPermissionRule[] | undefined,
  inherit: boolean,
): readonly KilnCommandPermissionRule[] {
  if (!scoped || scoped.length === 0) {
    return inherit ? (base ?? []) : [];
  }
  if (!inherit) {
    return [...scoped];
  }
  return [...(base ?? []), ...scoped];
}

function mergeFileGovernance(
  base: KilnFileGovernancePolicy | undefined,
  scoped: KilnFileGovernancePolicy | undefined,
  inherit: boolean,
): KilnFileGovernancePolicy {
  if (!scoped) {
    return inherit ? (base ?? {}) : {};
  }
  if (!inherit) {
    return {
      excludeFromContext: scoped.excludeFromContext,
      denyGlobs: deduplicateStrings(scoped.denyGlobs ?? []),
      askGlobs: deduplicateStrings(scoped.askGlobs ?? []),
      allowGlobs: deduplicateStrings(scoped.allowGlobs ?? []),
    };
  }

  return {
    excludeFromContext: scoped.excludeFromContext ?? base?.excludeFromContext,
    denyGlobs: deduplicateStrings([...(base?.denyGlobs ?? []), ...(scoped.denyGlobs ?? [])]),
    askGlobs: deduplicateStrings([...(base?.askGlobs ?? []), ...(scoped.askGlobs ?? [])]),
    allowGlobs: deduplicateStrings([...(base?.allowGlobs ?? []), ...(scoped.allowGlobs ?? [])]),
  };
}

function mergeMemoryPolicy(
  base: KilnMemoryPermissionPolicy | undefined,
  scoped: KilnMemoryPermissionPolicy | undefined,
  inherit: boolean,
): KilnMemoryPermissionPolicy {
  if (!scoped) {
    return inherit ? (base ?? {}) : {};
  }
  if (!inherit) {
    return {
      read: deduplicateMemoryRules(scoped.read ?? []),
      write: deduplicateMemoryRules(scoped.write ?? []),
    };
  }
  return {
    read: deduplicateMemoryRules([...(base?.read ?? []), ...(scoped.read ?? [])]),
    write: deduplicateMemoryRules([...(base?.write ?? []), ...(scoped.write ?? [])]),
  };
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
