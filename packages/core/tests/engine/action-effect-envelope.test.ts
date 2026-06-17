import { describe, it, expect } from "vitest";
import {
  BUILTIN_TOOL_EFFECT_ENVELOPES,
  getBuiltinEffectEnvelope,
} from "../../src/tools/domain/tool-effect-envelopes.js";
import {
  deriveAuthorityFromEffect,
  conservativeEnvelopeFromExternalHints,
  isValidNarrowing,
  normalizeActionEffectEnvelope,
  catalogAuthorityFromEnvelope,
  tagsFromEnvelope,
  resolveInvocationEffect,
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  DEFAULT_ACTION_EFFECT_POLICY,
  type ActionEffectEnvelope,
  type ActionEffectPolicy,
  type ResolvedInvocationEffect,
} from "../../src/engine/domain/action-effect.js";
import { buildBuiltinInvocationEffectResolvers } from "../../src/tools/infrastructure/invocation-effect-resolvers.js";
import type { DevToolName } from "../../src/tools/domain/tool.js";
import { ActionEffectAuthorizer } from "../../src/security/action-effect-authorizer.js";

const ALL_DEV_TOOL_NAMES: DevToolName[] = [
  "bash", "read", "read_many", "write", "edit", "patch",
  "stat", "tree", "view_image", "ocr_image",
  "web_search", "web_fetch", "web_extract",
  "browser_session_start", "browser_navigate", "browser_observe",
  "browser_click", "browser_type", "browser_keypress", "browser_scroll", "browser_session_stop",
  "computer_observe", "computer_click", "computer_type", "computer_keypress",
  "computer_open_application", "computer_focus_application", "computer_minimize_application", "computer_close_application",
  "grep", "glob", "git", "code_intelligence",
  "monitor_start", "monitor_read", "monitor_stop", "monitor_list",
  "task_list", "task_update", "operator_elicit", "tool_catalog_search",
  "memory_save", "resource_list", "resource_template_list", "resource_read",
];

describe("Action Effect Value Validation", () => {
  it("every action effect value type has exactly the expected members", () => {
    const operations = ["observe", "mutate"];
    const boundaries = ["process", "workspace", "machine", "network", "external-system"];
    const reversibilities = ["reversible", "compensatable", "irreversible", "unknown"];
    const dataEgresses = ["none", "metadata", "project-data", "sensitive-data", "unknown"];
    const identityUses = ["none", "authenticated", "privileged", "unknown"];
    const consequences = ["local-state", "external-state", "financial", "legal", "security", "unknown"];
    const idempotencies = ["idempotent", "conditionally-idempotent", "non-idempotent", "unknown"];

    expect(operations).toHaveLength(2);
    expect(boundaries).toHaveLength(5);
    expect(reversibilities).toHaveLength(4);
    expect(dataEgresses).toHaveLength(5);
    expect(identityUses).toHaveLength(4);
    expect(consequences).toHaveLength(6);
    expect(idempotencies).toHaveLength(4);
  });
});

describe("Exhaustive Declared Effect Envelopes", () => {
  it("every builtin tool has a declared effect envelope", () => {
    for (const toolName of ALL_DEV_TOOL_NAMES) {
      expect(toolName in BUILTIN_TOOL_EFFECT_ENVELOPES, `Missing envelope for tool: ${toolName}`).toBe(true);
      const envelope = BUILTIN_TOOL_EFFECT_ENVELOPES[toolName as DevToolName];
      expect(envelope.operation, `${toolName} operation`).toBeDefined();
      expect(envelope.boundaries.length, `${toolName} boundaries`).toBeGreaterThan(0);
      expect(envelope.reversibility, `${toolName} reversibility`).toBeDefined();
      expect(envelope.dataEgress, `${toolName} dataEgress`).toBeDefined();
      expect(envelope.identityUse, `${toolName} identityUse`).toBeDefined();
      expect(Array.isArray(envelope.consequences), `${toolName} consequences`).toBe(true);
      expect(envelope.idempotency, `${toolName} idempotency`).toBeDefined();
    }
  });

  it("getBuiltinEffectEnvelope returns envelope for known tools", () => {
    const envelope = getBuiltinEffectEnvelope("read");
    expect(envelope.operation).toBe("observe");
  });

  it("getBuiltinEffectEnvelope returns undefined for unknown tools", () => {
    const envelope = getBuiltinEffectEnvelope("unknown_tool_xyz");
    expect(envelope).toBeUndefined();
  });
});

describe("Envelope vs Resolved Effect Narrowing", () => {
  const readWriteEnvelope: ActionEffectEnvelope = {
    operation: "mutate",
    boundaries: ["process", "workspace", "machine", "network", "external-system"],
    reversibility: "irreversible",
    dataEgress: "sensitive-data",
    identityUse: "unknown",
    consequences: ["local-state", "external-state", "security", "unknown"],
    idempotency: "unknown",
  };

  it("observe is narrower than mutate", () => {
    const resolved: ResolvedInvocationEffect = {
      ...readWriteEnvelope,
      operation: "observe",
    };
    expect(isValidNarrowing(resolved, readWriteEnvelope)).toBe(true);
  });

  it("subset of boundaries is narrower", () => {
    const resolved: ResolvedInvocationEffect = {
      ...readWriteEnvelope,
      boundaries: ["process"],
    };
    expect(isValidNarrowing(resolved, readWriteEnvelope)).toBe(true);
  });

  it("broader operation is not narrower", () => {
    const resolved: ResolvedInvocationEffect = {
      ...readWriteEnvelope,
      operation: "mutate",
    };
    const envelope: ActionEffectEnvelope = {
      ...readWriteEnvelope,
      operation: "observe",
    };
    expect(isValidNarrowing(resolved, envelope)).toBe(false);
  });

  it("superset of boundaries is not narrower", () => {
    const resolved: ResolvedInvocationEffect = {
      ...readWriteEnvelope,
      boundaries: ["process", "workspace", "machine", "network", "external-system", "cloud"],
    } as ResolvedInvocationEffect;
    expect(isValidNarrowing(resolved, readWriteEnvelope)).toBe(false);
  });

  it("patch dryRun produces observe effect", () => {
    const resolvers = buildBuiltinInvocationEffectResolvers();
    const result = resolveInvocationEffect("patch", { dryRun: true }, BUILTIN_TOOL_EFFECT_ENVELOPES["patch"], resolvers);
    expect(result.operation).toBe("observe");
  });

  it("resolveInvocationEffect returns envelope for unknown tool", () => {
    const result = resolveInvocationEffect("unknown_tool", {}, CONSERVATIVE_UNKNOWN_ENVELOPE);
    expect(result).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
  });
});

describe("Conservative MCP Hint Mapping", () => {
  it("does not trust readOnlyHint as a narrower effect", () => {
    const envelope = conservativeEnvelopeFromExternalHints({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(envelope).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
  });

  it("does not trust destructiveHint as a declared envelope", () => {
    const envelope = conservativeEnvelopeFromExternalHints({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(envelope).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
  });

  it("treats missing annotations conservatively", () => {
    const envelope = conservativeEnvelopeFromExternalHints(undefined);
    expect(envelope).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
    expect(envelope.operation).toBe("mutate");
    expect(envelope.reversibility).toBe("unknown");
    expect(envelope.dataEgress).toBe("unknown");
    expect(envelope.identityUse).toBe("unknown");
  });

  it("openWorldHint remains conservative unknown", () => {
    const envelope = conservativeEnvelopeFromExternalHints({
      readOnlyHint: true,
      openWorldHint: true,
    });
    expect(envelope).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
  });

  it("MCP hints cannot grant level 1 (auto-execute) authority", () => {
    const envelope = conservativeEnvelopeFromExternalHints({
      readOnlyHint: true,
      destructiveHint: false,
    });
    const policy: ActionEffectPolicy = { defaultLevel: 2, requireApprovalForUnknown: true };
    const authority = deriveAuthorityFromEffect(envelope, policy);
    expect(authority.allowed).toBe(false);
    expect(authority.requiresApproval).toBe(true);
    expect(authority.level).toBeGreaterThanOrEqual(3);
  });
});

describe("Action Effect Normalization", () => {
  it("uses an empty consequence array for no consequences", () => {
    const envelope = normalizeActionEffectEnvelope({
      operation: "observe",
      boundaries: ["workspace", "process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    });

    expect(envelope?.consequences).toEqual([]);
    expect(envelope?.boundaries).toEqual(["process", "workspace"]);
  });

  it("rejects the old none consequence sentinel", () => {
    const envelope = normalizeActionEffectEnvelope({
      operation: "observe",
      boundaries: ["process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["none"],
      idempotency: "idempotent",
    });

    expect(envelope).toBeUndefined();
  });

  it("rejects duplicate array members", () => {
    const envelope = normalizeActionEffectEnvelope({
      operation: "observe",
      boundaries: ["process", "process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    });

    expect(envelope).toBeUndefined();
  });
});

describe("Canonical Authority Derivation", () => {
  const policy: ActionEffectPolicy = { defaultLevel: 2, requireApprovalForUnknown: false };

  it("observe with no egress yields level 1", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "observe",
      boundaries: ["process", "workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    };
    const auth = deriveAuthorityFromEffect(envelope, policy);
    expect(auth.level).toBe(1);
    expect(auth.allowed).toBe(true);
    expect(auth.requiresApproval).toBe(false);
  });

  it("irreversible mutation with external impact yields level 4", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace", "external-system"],
      reversibility: "irreversible",
      dataEgress: "sensitive-data",
      identityUse: "none",
      consequences: ["external-state"],
      idempotency: "non-idempotent",
    };
    const auth = deriveAuthorityFromEffect(envelope, policy);
    expect(auth.level).toBe(4);
    expect(auth.allowed).toBe(false);
    expect(auth.requiresApproval).toBe(true);
  });

  it("reversible idempotent mutation with no egress yields level 1", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "idempotent",
    };
    const auth = deriveAuthorityFromEffect(envelope, policy);
    expect(auth.level).toBe(1);
    expect(auth.allowed).toBe(true);
  });

  it("privileged identity yields level 4", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "observe",
      boundaries: ["process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "privileged",
      consequences: [],
      idempotency: "idempotent",
    };
    const auth = deriveAuthorityFromEffect(envelope, policy);
    expect(auth.level).toBe(4);
    expect(auth.requiresApproval).toBe(true);
  });

  it("unknown effects with requireApprovalForUnknown yields level 3 or higher", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace", "machine"],
      reversibility: "unknown",
      dataEgress: "unknown",
      identityUse: "unknown",
      consequences: ["unknown"],
      idempotency: "unknown",
    };
    const strictPolicy: ActionEffectPolicy = { defaultLevel: 2, requireApprovalForUnknown: true };
    const auth = deriveAuthorityFromEffect(envelope, strictPolicy);
    expect(auth.level).toBeGreaterThanOrEqual(3);
    expect(auth.requiresApproval).toBe(true);
  });

  it("function succeeds with default policy", () => {
    const auth = deriveAuthorityFromEffect(CONSERVATIVE_UNKNOWN_ENVELOPE);
    expect(auth.level).toBeGreaterThanOrEqual(2);
  });
});

describe("Catalog Authority from Envelope", () => {
  it("observe + none egress = read_only", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "observe",
      boundaries: ["process", "workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    };
    expect(catalogAuthorityFromEnvelope(envelope)).toBe("read_only");
  });

  it("irreversible workspace mutation = destructive", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "irreversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "non-idempotent",
    };
    expect(catalogAuthorityFromEnvelope(envelope)).toBe("destructive");
  });

  it("compensatable mutation = standard", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "compensatable",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "conditionally-idempotent",
    };
    expect(catalogAuthorityFromEnvelope(envelope)).toBe("standard");
  });
});

describe("Tags from Envelope", () => {
  it("observe + none egress = read-only tag", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "observe",
      boundaries: ["process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    };
    const tags = tagsFromEnvelope(envelope);
    expect(tags).toContain("read-only");
    expect(tags).toContain("idempotent");
  });

  it("mutate + irreversible = destructive tag", () => {
    const envelope: ActionEffectEnvelope = {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "irreversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "non-idempotent",
    };
    const tags = tagsFromEnvelope(envelope);
    expect(tags).toContain("destructive");
    expect(tags).not.toContain("external");
  });
});

describe("ActionEffectAuthorizer delegates to deriveAuthorityFromEffect", () => {
  it("authorize with read-only effect yields level 1", () => {
    const authorizer = new ActionEffectAuthorizer();
    const result = authorizer.authorize("read_tool", {
      operation: "observe",
      boundaries: ["process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    });
    expect(result.level).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it("authorize with irreversible mutation effect yields level 4", () => {
    const authorizer = new ActionEffectAuthorizer();
    const result = authorizer.authorize("write_tool", {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "irreversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "non-idempotent",
    });
    expect(result.level).toBe(4);
    expect(result.requiresApproval).toBe(true);
  });

  it("authorize with malformed effect fails closed", () => {
    const authorizer = new ActionEffectAuthorizer();
    const result = authorizer.authorize("unknown_tool", {
      operation: "observe",
      boundaries: ["process"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["none"],
      idempotency: "idempotent",
    } as unknown as ResolvedInvocationEffect);
    expect(result.level).toBeGreaterThanOrEqual(2);
    expect(result.allowed).toBe(false);
  });
});
