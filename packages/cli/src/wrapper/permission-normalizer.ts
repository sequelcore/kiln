import type {
  KilnPermissionPolicy,
  KilnToolPermissionRule,
  KilnCommandPermissionRule,
  KilnFileGovernancePolicy,
  KilnDataFirewallRule,
} from "./session.js";

export const SAFE_DEFAULTS_TOOL_RULES: readonly KilnToolPermissionRule[] = [
  { tool: "Read", action: "allow" },
  { tool: "Glob", action: "allow" },
  { tool: "Grep", action: "allow" },
  { tool: "List", action: "allow" },
  { tool: "LSP", action: "allow" },
  { tool: "CodeSearch", action: "allow" },
  { tool: "Edit", action: "ask" },
  { tool: "Task", action: "ask" },
  { tool: "Bash", action: "ask" },
  { tool: "WebFetch", action: "deny" },
  { tool: "WebSearch", action: "deny" },
  { tool: "ExternalDirectory", action: "deny" },
];

export const SAFE_DEFAULTS_COMMAND_RULES: readonly KilnCommandPermissionRule[] = [
  { pattern: "git status*", action: "allow" },
  { pattern: "git diff*", action: "allow" },
  { pattern: "git log*", action: "allow" },
  { pattern: "git show*", action: "allow" },
  { pattern: "bun test*", action: "ask" },
  { pattern: "npm test*", action: "ask" },
  { pattern: "rm *", action: "ask" },
  { pattern: "mv *", action: "ask" },
  { pattern: "cp *", action: "ask" },
  { pattern: "curl *", action: "deny" },
  { pattern: "gh auth *", action: "deny" },
  { pattern: "gh secret *", action: "deny" },
  { pattern: "printenv*", action: "deny" },
  { pattern: "env", action: "deny" },
];

export const SAFE_DEFAULTS_FILE_GOVERNANCE: KilnFileGovernancePolicy = {
  excludeFromContext: true,
  denyGlobs: [
    "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx",
    "**/id_rsa", "**/id_ed25519", "**/.ssh/**", "**/.aws/**", "**/.gnupg/**",
    "**/.npmrc", "**/.pypirc", "**/.docker/config.json", "**/.git-credentials",
    "**/secrets/**", "**/credentials/**", "**/.git/**", "**/.claude/**",
    "**/.vscode/**", "**/.idea/**",
  ],
  askGlobs: ["**/.env.example", "**/*.example", "**/*.sample"],
};

export const SAFE_DEFAULTS_DATA_FIREWALL: readonly KilnDataFirewallRule[] = [
  { destination: "logs", action: "redact", classifications: ["pii", "secret", "credential", "token"] },
  { destination: "ci", action: "deny", classifications: ["secret", "credential", "token"] },
  { destination: "github-actions", action: "deny", classifications: ["secret", "credential", "token"] },
  { destination: "small-model", action: "deny", classifications: ["secret", "credential"] },
  { destination: "webhook", action: "redact", classifications: ["pii", "secret", "credential"] },
];

export function normalizePermissionPolicy(policy: KilnPermissionPolicy): KilnPermissionPolicy & {
  tools: readonly KilnToolPermissionRule[];
  commands: readonly KilnCommandPermissionRule[];
  fileGovernance: KilnFileGovernancePolicy;
  dataFirewall: readonly KilnDataFirewallRule[];
  agentScopes: readonly import("./session.js").KilnAgentPermissionScope[];
} {
  const safeDefaults = policy.safeDefaults ?? false;

  const baseTools = safeDefaults ? [...SAFE_DEFAULTS_TOOL_RULES] : [];
  const baseCommands = safeDefaults ? [...SAFE_DEFAULTS_COMMAND_RULES] : [];
  const baseFileGovernance: KilnFileGovernancePolicy = safeDefaults ? { ...SAFE_DEFAULTS_FILE_GOVERNANCE } : {};
  const baseDataFirewall = safeDefaults ? [...SAFE_DEFAULTS_DATA_FIREWALL] : [];

  const tools = deduplicateByKey([...baseTools, ...(policy.tools ?? [])], (r) => r.tool);
  const commands = deduplicateByKey(
    [...baseCommands, ...(policy.commands ?? [])],
    (r) => `${r.pattern}::${r.shell ?? "any"}`,
  );
  const fileGovernance = mergeFileGovernance(baseFileGovernance, policy.fileGovernance);
  const dataFirewall = [...baseDataFirewall, ...(policy.dataFirewall ?? [])];

  return {
    ...policy,
    safeDefaults,
    auditLog: policy.auditLog ?? (safeDefaults ? true : undefined),
    tools,
    commands,
    fileGovernance,
    dataFirewall,
    agentScopes: policy.agentScopes ?? [],
  };
}

function deduplicateByKey<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, number>();
  arr.forEach((item, i) => seen.set(key(item), i));
  return arr.filter((item, i) => seen.get(key(item)) === i);
}

function mergeFileGovernance(base: KilnFileGovernancePolicy, user: KilnFileGovernancePolicy | undefined): KilnFileGovernancePolicy {
  if (!user) return base;
  return {
    excludeFromContext: user.excludeFromContext ?? base.excludeFromContext,
    denyGlobs: dedupStrings([...(base.denyGlobs ?? []), ...(user.denyGlobs ?? [])]),
    askGlobs: dedupStrings([...(base.askGlobs ?? []), ...(user.askGlobs ?? [])]),
    allowGlobs: dedupStrings([...(base.allowGlobs ?? []), ...(user.allowGlobs ?? [])]),
  };
}

function dedupStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}
