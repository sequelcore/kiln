import type { Agent, DomainConfig } from "@kilnai/core";
import type { KilnPermissionPolicy } from "./session.js";
import type { SessionContext } from "./index.js";

const MEMORY_LINE_LIMIT = 200;

function trimMemory(memory: string): string {
  const lines = memory.split("\n");
  if (lines.length <= MEMORY_LINE_LIMIT) return memory;
  const omitted = lines.length - MEMORY_LINE_LIMIT;
  return (
    lines.slice(0, MEMORY_LINE_LIMIT).join("\n") +
    `\n[memory truncated — ${omitted} lines omitted]`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, content: string): string {
  return `<${name}>${content}</${name}>`;
}

function buildRoleSection(agent: Agent): string | null {
  if (!agent.name && !agent.role && !agent.goal) return null;
  const parts: string[] = [];
  parts.push(`You are ${agent.name || "Agent"}, ${agent.role || "assistant"}. Goal: ${agent.goal || "assist the user"}`);
  if (agent.backstory) {
    parts.push(agent.backstory);
  }
  return tag("role", parts.join("\n"));
}

function buildTaskSection(task: string): string {
  return tag("task", escapeXml(task));
}

function buildDomainSection(domain: DomainConfig): string | null {
  const toolTags = [...domain.toolTags];
  const gates = domain.qualityGates.map((g) => g.name);

  if (toolTags.length === 0 && gates.length === 0) return null;

  const parts: string[] = [];
  parts.push(`Project type: ${domain.displayName}`);
  if (toolTags.length > 0) {
    parts.push(`Tool tags: ${toolTags.join(", ")}`);
  }
  if (gates.length > 0) {
    parts.push(`Quality gates: ${gates.join(", ")}`);
  }
  return tag("domain", parts.join("\n"));
}

function buildConstraintsSection(policy: KilnPermissionPolicy): string {
  return tag(
    "constraints",
    `Approval mode: ${policy.approval}\nSandbox: ${policy.sandbox}`,
  );
}

function buildMemorySection(snapshot: string | undefined): string | null {
  if (!snapshot || snapshot.trim() === "") return null;
  return tag("memory", escapeXml(trimMemory(snapshot)));
}

function buildInstructionsSection(instructions: string | undefined): string | null {
  if (!instructions || instructions.trim() === "") return null;
  return tag("instructions", escapeXml(instructions));
}

export function buildPreamble(
  ctx: SessionContext,
  policy: KilnPermissionPolicy,
  agent?: Agent,
): string {
  const sections: (string | null)[] = [
    agent ? buildRoleSection(agent) : null,
    buildTaskSection(ctx.task),
    buildDomainSection(ctx.domain),
    buildConstraintsSection(policy),
    buildMemorySection(ctx.memorySnapshot),
    buildInstructionsSection(agent?.instructions),
  ];

  const active = sections.filter((s): s is string => s !== null);
  return tag("kiln-preamble", active.join("\n"));
}
