import { createInterface } from "node:readline/promises";
import { readGlobalConfig } from "../config/global-config.js";
import { readGlobalExternalSkillInventory } from "../config/skill-catalog-status.js";
import { writeExternalSkillApproval } from "../config/external-skill-approval-store.js";
import type { SkillPackageFiles } from "../config/skill-source-inventory.js";

export async function reviewExternalSkill(selector: string | undefined): Promise<void> {
  const selected = readGlobalConfig()?.skills?.externalCatalog?.harnesses.codex?.keepImplicit ?? [];
  const packages = new Map<string, SkillPackageFiles>();
  const { inventory } = readGlobalExternalSkillInventory({
    onCandidateResolved: (sourceId, _path, files) => packages.set(sourceId, files),
  });
  if (!inventory.complete) throw new Error("Skill inventory is incomplete; approval refused.");
  const candidates = inventory.candidates.filter(
    (candidate) =>
      candidate.relationship === "external" &&
      candidate.applicableHarnesses.includes("codex") &&
      candidate.exposureScope !== "project" &&
      candidate.effectiveVisibility === "implicit",
  );
  if (!selector) {
    for (const candidate of candidates) console.log(`${candidate.name}\n  ${candidate.sourceId}`);
    console.log("Run kiln skill review <name-or-source-id> to review a configured skill.");
    return;
  }
  const matches = candidates.filter((candidate) => candidate.sourceId === selector || candidate.name === selector);
  const candidate = matches.length === 1 ? matches[0] : undefined;
  if (!candidate)
    throw new Error("Skill is absent or its name is ambiguous; use the exact source ID from kiln skill review.");
  if (!selected.some((decision) => decision.sourceId === candidate.sourceId)) {
    throw new Error(
      `Select ${candidate.sourceId} in skills.externalCatalog.harnesses.codex.keepImplicit before reviewing it.`,
    );
  }
  if (candidate.health.status === "blocked")
    throw new Error(`Cannot approve ${candidate.name}: package health is blocked.`);
  const files = packages.get(candidate.sourceId);
  if (!files) throw new Error(`Package contents are unavailable for ${candidate.name}.`);
  console.log(`Review ${candidate.name}\nSource: ${candidate.sourceId}`);
  for (const file of files) {
    // Escape terminal control characters in untrusted package contents.
    const text = Buffer.from(file.content)
      .toString("utf8")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, (character) => JSON.stringify(character).slice(1, -1));
    console.log(`\nFile: ${JSON.stringify(file.path)}\n${text}`);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Approval requires an interactive terminal. No approval was recorded.");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question("Approve these exact package contents for Codex? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("No approval recorded.");
      return;
    }
    const current = readGlobalExternalSkillInventory({});
    const matches = current.inventory.candidates.filter((item) => item.sourceId === candidate.sourceId);
    if (
      !current.inventory.complete ||
      matches.length !== 1 ||
      matches[0]?.packageDigest !== candidate.packageDigest ||
      matches[0]?.health.status === "blocked"
    ) {
      throw new Error("Skill changed during review; review the current contents again.");
    }
    writeExternalSkillApproval({
      version: 1,
      harness: "codex",
      sourceId: candidate.sourceId,
      packageDigest: candidate.packageDigest,
    });
    console.log(`Approved ${candidate.name}. Run kiln sync to apply the exposure rules.`);
  } finally {
    terminal.close();
  }
}
