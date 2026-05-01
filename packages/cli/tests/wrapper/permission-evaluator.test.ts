import { describe, expect, it } from "vitest";
import {
  convertEffectiveMemoryPermissionPolicyToMemoryAuthorityPolicy,
  createPermissionEvaluator,
  resolveEffectivePermissionPolicy,
} from "../../src/wrapper/permission-evaluator.js";
import type { KilnPermissionPolicy } from "../../src/wrapper/session.js";

describe("permission-evaluator", () => {
  it("evaluates safe-default policy using normalized rules", () => {
    const evaluator = createPermissionEvaluator({ safeDefaults: true });

    const toolDecision = evaluator.evaluateTool("WebFetch");
    expect(toolDecision.action).toBe("deny");
    expect(toolDecision.source).toBe("tool-rule");
    expect(toolDecision.match?.key).toBe("WebFetch");

    const commandDecision = evaluator.evaluateCommand("git status --short", "bash");
    expect(commandDecision.action).toBe("allow");
    expect(commandDecision.source).toBe("command-rule");
  });

  it("uses last-match-wins for tool rules", () => {
    const evaluator = createPermissionEvaluator({
      tools: [
        { tool: "Edit", action: "deny", reason: "base deny" },
        { tool: "Edit", action: "allow", reason: "override allow" },
      ],
    });

    const decision = evaluator.evaluateTool("Edit");
    expect(decision.action).toBe("allow");
    expect(decision.match?.reason).toBe("override allow");
  });

  it("uses last-match-wins for command rules", () => {
    const evaluator = createPermissionEvaluator({
      commands: [
        { pattern: "git *", action: "deny", reason: "deny all git" },
        { pattern: "git *", action: "allow", reason: "override git" },
      ],
    });

    const decision = evaluator.evaluateCommand("git diff --name-only", "bash");
    expect(decision.action).toBe("allow");
    expect(decision.source).toBe("command-rule");
    expect(decision.match?.reason).toBe("override git");
  });

  it("distinguishes file governance deny/ask/allow", () => {
    const evaluator = createPermissionEvaluator({
      fileGovernance: {
        denyGlobs: ["**/.env"],
        askGlobs: ["**/secrets/*.txt"],
        allowGlobs: ["**/*.md"],
      },
    });

    const denyDecision = evaluator.evaluateFile("project/.env");
    expect(denyDecision.action).toBe("deny");
    expect(denyDecision.source).toBe("file-governance.deny");

    const askDecision = evaluator.evaluateFile("project/secrets/token.txt");
    expect(askDecision.action).toBe("ask");
    expect(askDecision.source).toBe("file-governance.ask");

    const allowDecision = evaluator.evaluateFile("project/docs/readme.md");
    expect(allowDecision.action).toBe("allow");
    expect(allowDecision.source).toBe("file-governance.allow");
  });

  it("falls back to coarse approval mode for unmatched file governance paths", () => {
    const askEvaluator = createPermissionEvaluator({
      approval: "on-request",
      fileGovernance: {
        denyGlobs: ["**/.env"],
      },
    });
    const askDecision = askEvaluator.evaluateFile("project/src/index.ts");
    expect(askDecision.source).toBe("default");
    expect(askDecision.action).toBe("ask");

    const denyEvaluator = createPermissionEvaluator({
      approval: "untrusted",
      fileGovernance: {
        denyGlobs: ["**/.env"],
      },
    });
    const denyDecision = denyEvaluator.evaluateFile("project/src/index.ts");
    expect(denyDecision.source).toBe("default");
    expect(denyDecision.action).toBe("deny");
  });

  it("evaluates data firewall destinations and preserves redact semantics", () => {
    const evaluator = createPermissionEvaluator({
      dataFirewall: [
        { destination: "logs", action: "redact", classifications: ["secret"] },
        { destination: "ci", action: "deny", classifications: ["secret"] },
      ],
    });

    const redactDecision = evaluator.evaluateDestination("logs", ["secret"]);
    expect(redactDecision.action).toBe("allow");
    expect(redactDecision.source).toBe("data-firewall");
    expect(redactDecision.dataFirewallAction).toBe("redact");

    const denyDecision = evaluator.evaluateDestination("ci", ["secret"]);
    expect(denyDecision.action).toBe("deny");
    expect(denyDecision.source).toBe("data-firewall");
    expect(denyDecision.dataFirewallAction).toBe("deny");
  });

  it("resolves effective policy for agent scopes with inherit=true overrides", () => {
    const policy: KilnPermissionPolicy = {
      tools: [{ tool: "Edit", action: "ask" }],
      agentScopes: [
        {
          agent: "worker",
          inherit: true,
          tools: [{ tool: "Edit", action: "deny", reason: "worker restricted" }],
          mcpTools: ["memory.read"],
        },
      ],
    };

    const resolved = resolveEffectivePermissionPolicy(policy, "worker");
    expect(resolved.scope.matchedScope).toBe(true);
    expect(resolved.scope.inherit).toBe(true);
    expect(resolved.scope.mcpTools).toEqual(["memory.read"]);

    const evaluator = createPermissionEvaluator(policy, { agent: "worker" });
    const decision = evaluator.evaluateTool("Edit");
    expect(decision.action).toBe("deny");
    expect(decision.match?.reason).toBe("worker restricted");
    expect(decision.scope.matchedScope).toBe(true);
  });

  it("resolves effective policy for agent scopes with inherit=false", () => {
    const policy: KilnPermissionPolicy = {
      safeDefaults: true,
      agentScopes: [
        {
          agent: "planner",
          inherit: false,
          tools: [{ tool: "Read", action: "allow" }],
        },
      ],
    };

    const evaluator = createPermissionEvaluator(policy, { agent: "planner" });
    const allowedRead = evaluator.evaluateTool("Read");
    expect(allowedRead.action).toBe("allow");
    expect(allowedRead.scope.inherit).toBe(false);

    const defaultDecision = evaluator.evaluateTool("WebFetch");
    expect(defaultDecision.source).toBe("default");
    expect(defaultDecision.action).toBe("ask");
  });

  it("merges root and agent memory policy when inherit=true", () => {
    const policy: KilnPermissionPolicy = {
      memory: {
        read: [
          {
            operations: ["read"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
        write: [
          {
            operations: ["save"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
      },
      agentScopes: [
        {
          agent: "worker",
          inherit: true,
          memory: {
            write: [
              {
                operations: ["revise"],
                scopeKinds: ["project"],
                scopeIds: ["kiln"],
                layers: ["working"],
              },
            ],
          },
        },
      ],
    };

    const resolved = resolveEffectivePermissionPolicy(policy, "worker");
    expect(resolved.policy.memory.read).toHaveLength(1);
    expect(resolved.policy.memory.write).toHaveLength(2);
    expect(resolved.policy.memory.write.map((rule) => rule.operations[0])).toEqual(["save", "revise"]);
  });

  it("replaces root memory policy when agent scope uses inherit=false", () => {
    const policy: KilnPermissionPolicy = {
      memory: {
        read: [
          {
            operations: ["read"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
        write: [
          {
            operations: ["save"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
      },
      agentScopes: [
        {
          agent: "planner",
          inherit: false,
          memory: {
            write: [
              {
                operations: ["compact"],
                scopeKinds: ["project"],
                scopeIds: ["kiln"],
                layers: ["semantic"],
              },
            ],
          },
        },
      ],
    };

    const resolved = resolveEffectivePermissionPolicy(policy, "planner");
    expect(resolved.policy.memory.read).toHaveLength(0);
    expect(resolved.policy.memory.write).toHaveLength(1);
    expect(resolved.policy.memory.write[0]?.operations).toEqual(["compact"]);
  });

  it("converts effective memory permissions into core MemoryAuthorityPolicy", () => {
    const policy: KilnPermissionPolicy = {
      memory: {
        read: [
          {
            operations: ["read"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
      },
      agentScopes: [
        {
          agent: "writer",
          inherit: true,
          memory: {
            write: [
              {
                operations: ["save", "revise"],
                scopeKinds: ["project"],
                scopeIds: ["kiln"],
                layers: ["working", "audit"],
                allowAuditWrite: true,
              },
            ],
          },
        },
      ],
    };

    const resolved = resolveEffectivePermissionPolicy(policy, "writer");
    const authority = convertEffectiveMemoryPermissionPolicyToMemoryAuthorityPolicy(resolved.policy, {
      kind: "agent",
      id: "writer",
    });

    expect(authority.caller).toEqual({ kind: "agent", id: "writer" });
    expect(authority.rules).toHaveLength(2);
    expect(authority.rules[0]).toMatchObject({
      access: "read",
      operations: ["read"],
      scopeKinds: ["project"],
      scopeIds: ["kiln"],
      layers: ["working"],
    });
    expect(authority.rules[1]).toMatchObject({
      access: "write",
      operations: ["save", "revise"],
      scopeKinds: ["project"],
      scopeIds: ["kiln"],
      layers: ["working", "audit"],
      allowAuditWrite: true,
    });
  });
});
