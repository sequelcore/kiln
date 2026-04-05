import type { Agent, DomainConfig } from "@kilnai/core";
import { renderProjectedContext } from "../application/context-types.js";
import type { KilnPermissionPolicy } from "./session.js";
import type { SessionContext } from "./index.js";

export const PREAMBLE_CACHE_BOUNDARY = "__KILN_PROMPT_DYNAMIC_BOUNDARY__";

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

function buildCompactionRecoverySection(): string {
  return `<kiln-compaction-recovery>After any context compaction: 1) save a session summary using format Goal/Instructions/Discoveries/Accomplished/Next Steps/Relevant Files, 2) recall your memory context, then continue.</kiln-compaction-recovery>`;
}

export function buildPreamble(
  ctx: SessionContext,
  policy: KilnPermissionPolicy,
  agent?: Agent,
): string {
  const shouldExcludeMemory = policy.fileGovernance?.excludeFromContext === true;
  const renderedProjectedContext = shouldExcludeMemory
    ? undefined
    : renderProjectedContext(ctx.projectedContext);

  const staticSections: (string | null)[] = [
    agent ? buildRoleSection(agent) : null,
    buildDomainSection(ctx.domain),
    buildConstraintsSection(policy),
    buildCompactionRecoverySection(),
  ];

  const dynamicSections: (string | null)[] = [
    buildTaskSection(ctx.task),
    buildMemorySection(renderedProjectedContext),
    buildInstructionsSection(agent?.instructions),
  ];

  const parts: string[] = [
    ...staticSections.filter((s): s is string => s !== null),
    PREAMBLE_CACHE_BOUNDARY,
    ...dynamicSections.filter((s): s is string => s !== null),
  ];

  if (ctx.isWorker) {
    parts.push(
      `<kiln-fork-boilerplate>\nYou are a focused subagent. Complete the task above, emit your result, then stop. Do not ask for clarification. Do not loop. Output structured results as requested.\n</kiln-fork-boilerplate>`,
    );
  }

  return tag("kiln-preamble", parts.join("\n"));
}
