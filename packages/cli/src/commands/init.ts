import type {
  KilnConfigurationOnboardingApplyRequest,
  KilnConfigurationOnboardingSnapshot,
} from "@kilnai/gateway-contracts";
import type { KilnAppConfig } from "../config.js";
import { readKilnYamlFile, type KilnProjectConfig } from "../kiln-yaml.js";
import {
  applyConfigurationOnboarding,
  readConfigurationOnboarding,
  type ConfigurationOnboardingDependencies,
} from "../application/configuration-onboarding.js";
import {
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "../application/project-state-root.js";

export interface InitFlags {
  interactive?: boolean;
  targetId?: string;
  posture?: KilnConfigurationOnboardingApplyRequest["posture"];
  approve?: boolean;
  kilnHome?: string;
  projectStateBinding?: ProjectStateBinding;
  /** Test/runtime injection; never serialized into canonical project state. */
  dependencies?: ConfigurationOnboardingDependencies;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Runs the first-run project adoption flow. The only canonical writer is the
 * configuration mutation authority reached through the onboarding service;
 * this command never creates app/gateway/memory templates or provider intent.
 */
export async function initCommand(
  _appConfig: KilnAppConfig,
  projectPath?: string,
  flags: InitFlags = {},
): Promise<KilnProjectConfig | null> {
  const root = projectPath ?? process.cwd();
  const binding = flags.projectStateBinding
    ?? resolveProjectStateBinding(root, flags);
  const interactive = flags.interactive !== false && process.stdin.isTTY === true;
  const snapshot = readConfigurationOnboarding({
    projectPath: root,
    posture: flags.posture,
    projectStateBinding: binding,
    dependencies: flags.dependencies,
  });

  if (snapshot.status === "blocked") {
    reportBlocked(snapshot);
    return null;
  }

  let targetId = flags.targetId
    ?? snapshot.defaultTargetId
    ?? (interactive ? snapshot.targets[0]?.id : undefined);
  const posture = flags.posture ?? snapshot.posture;
  let approve = flags.approve === true;

  if (interactive) {
    targetId = await chooseTarget(snapshot, targetId);
    const postureAccepted = isAffirmative(await prompt("Use the read-only permission posture? (y/n)", "y"));
    if (!postureAccepted) {
      console.log("Onboarding cancelled. No configuration was written.");
      return null;
    }
    if (targetId !== snapshot.defaultTargetId && !approve) {
      const selectedTarget = snapshot.targets.find((target) => target.id === targetId);
      const targetLabel = selectedTarget ? `${selectedTarget.label} (${selectedTarget.id})` : targetId;
      const approval = await prompt(`Approve changing the default target to ${targetLabel}? (y/n)`, "n");
      approve = isAffirmative(approval);
      if (!approve) {
        console.log("Onboarding cancelled. No configuration was written.");
        return null;
      }
    }
    const confirmation = await prompt("Apply onboarding? (y/n)", "y");
    if (!isAffirmative(confirmation)) {
      console.log("Onboarding cancelled. No configuration was written.");
      return null;
    }
  }

  const request: KilnConfigurationOnboardingApplyRequest = {
    schemaVersion: 1,
    scope: "project",
    posture,
    targetId: targetId ?? null,
  };
  const result = await applyConfigurationOnboarding({
    projectPath: root,
    request,
    approve,
    projectStateBinding: binding,
    dependencies: flags.dependencies,
  });

  if (result.status === "blocked" || result.status === "rejected") {
    const message = result.nextAction ?? "Onboarding did not complete.";
    console.error(message);
    return readAdoptedProject(binding);
  }
  if (result.status === "partial") {
    console.error(result.nextAction ?? "Onboarding partially applied; review the reported operation outcomes.");
  } else if (result.projectAdoption === null && result.targetSelection === null) {
    console.log("Already initialized.");
  } else {
    console.log("Kiln project onboarding complete.");
  }
  return readAdoptedProject(binding);
}

async function chooseTarget(snapshot: KilnConfigurationOnboardingSnapshot, current: string | undefined): Promise<string | undefined> {
  if (snapshot.targets.length <= 1) return current;
  console.log("\nAdmitted direct targets:");
  snapshot.targets.forEach((target, index) => {
    console.log(`  ${index + 1}. ${target.label} (${target.id})${target.selected ? " *" : ""}`);
  });
  const defaultIndex = Math.max(0, snapshot.targets.findIndex((target) => target.id === current));
  const answer = await prompt(`Select target (1-${snapshot.targets.length})`, String(defaultIndex + 1));
  const index = Number.parseInt(answer, 10) - 1;
  return snapshot.targets[Math.max(0, Math.min(index, snapshot.targets.length - 1))]?.id ?? current;
}

function reportBlocked(snapshot: KilnConfigurationOnboardingSnapshot): void {
  console.error(snapshot.blockers[0]?.message ?? "Onboarding is blocked.");
  if (snapshot.nextAction) console.error(snapshot.nextAction);
}

function readAdoptedProject(binding: ProjectStateBinding): KilnProjectConfig | null {
  try {
    return readKilnYamlFile(binding.configPath);
  } catch {
    return null;
  }
}

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
