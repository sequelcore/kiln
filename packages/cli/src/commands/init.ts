import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DomainRegistry } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { generateAppYaml, generateGatewayYaml } from "./init-templates.js";
import type { InitOptions } from "./init-templates.js";
import { defaultKilnYaml, writeKilnYaml } from "../kiln-yaml.js";
import type { KilnProjectConfig } from "../kiln-yaml-types.js";

export interface InitFlags {
  force?: boolean;
  interactive?: boolean;
  domain?: string;
  provider?: string;
  channels?: string;
  teamMode?: string;
}

async function prompt(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` [${defaultVal}]` : "";
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export async function initCommand(
  appConfig: KilnAppConfig,
  projectPath?: string,
  flags?: InitFlags,
): Promise<KilnProjectConfig | null> {
  const root = projectPath ?? process.cwd();
  const appDir = join(root, ".kiln");

  if (existsSync(appDir) && !flags?.force) {
    console.log("Already initialized.");
    return null;
  }

  const isInteractive =
    flags?.interactive !== false && process.stdin.isTTY === true;

  const builtins = DomainRegistry.loadBuiltinDomains();
  const registry = appConfig.createRegistry();
  for (const d of builtins) {
    registry.register(d);
  }
  registry.loadInstalledDomains(root);

  const allDomains = registry.all();
  const detected = registry.detect(root);
  const detectedDomain = detected.length > 0 ? detected[0]! : null;

  let chosenDomainName: string;
  let chosenProvider: string;
  let chosenChannels: string[];
  let chosenTeamMode: string;

  if (isInteractive) {
    if (detectedDomain) {
      console.log(`\nDetected domain: ${detectedDomain.displayName} (${detectedDomain.name})`);
      const confirm = await prompt("Use detected domain? (y/n)", "y");
      if (confirm.toLowerCase() === "n") {
        if (allDomains.length > 0) {
          console.log("\nAvailable domains:");
          for (let i = 0; i < allDomains.length; i++) {
            console.log(`  ${i + 1}. ${allDomains[i]!.displayName} (${allDomains[i]!.name})`);
          }
          const sel = await prompt(`Select domain (1-${allDomains.length})`, "1");
          const idx = parseInt(sel, 10) - 1;
          const selected = allDomains[Math.max(0, Math.min(idx, allDomains.length - 1))];
          chosenDomainName = selected?.name ?? detectedDomain.name;
        } else {
          chosenDomainName = detectedDomain.name;
        }
      } else {
        chosenDomainName = detectedDomain.name;
      }
    } else if (allDomains.length > 0) {
      console.log("\nNo domain detected. Available domains:");
      for (let i = 0; i < allDomains.length; i++) {
        console.log(`  ${i + 1}. ${allDomains[i]!.displayName} (${allDomains[i]!.name})`);
      }
      const sel = await prompt(`Select domain (1-${allDomains.length})`, "1");
      const idx = parseInt(sel, 10) - 1;
      const selected = allDomains[Math.max(0, Math.min(idx, allDomains.length - 1))];
      chosenDomainName = selected?.name ?? "generic";
    } else {
      chosenDomainName = "generic";
    }

    const providerAnswer = await prompt(
      "Provider (anthropic/openai/deepseek/ollama)",
      "anthropic",
    );
    chosenProvider = providerAnswer || "anthropic";

    const channelsAnswer = await prompt("Channels (comma-separated: cli,web,api)", "cli,web");
    chosenChannels = (channelsAnswer || "cli,web")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    const teamModeAnswer = await prompt(
      "Team mode (sequential/supervisor/swarm)",
      "sequential",
    );
    chosenTeamMode = teamModeAnswer || "sequential";
  } else {
    if (flags?.domain) {
      chosenDomainName = flags.domain;
    } else if (detectedDomain) {
      chosenDomainName = detectedDomain.name;
    } else {
      chosenDomainName = "generic";
    }

    chosenProvider = flags?.provider ?? "anthropic";
    chosenChannels = flags?.channels
      ? flags.channels.split(",").map((c) => c.trim()).filter(Boolean)
      : ["cli", "web"];
    chosenTeamMode = flags?.teamMode ?? "sequential";
  }

  const chosenDomainConfig =
    registry.get(chosenDomainName) ??
    (detectedDomain?.name === chosenDomainName ? detectedDomain : null);
  const qualityGates = chosenDomainConfig?.qualityGates ?? [];

  const kilnYaml: KilnProjectConfig = {
    ...defaultKilnYaml(chosenDomainName),
    channels: chosenChannels,
    teamMode: chosenTeamMode,
    requireApproval: true,
    maxDepth: 3,
    parallelWorkers: 2,
  };

  const initOptions: InitOptions = {
    appName: "kiln",
    domain: chosenDomainName,
    domainDisplayName: chosenDomainConfig?.displayName ?? chosenDomainName,
    provider: chosenProvider,
    channels: chosenChannels,
    teamMode: chosenTeamMode,
    qualityGates: qualityGates.map((g) => ({
      name: g.name,
      command: g.command,
      description: g.description ?? g.name,
    })),
  };

  writeKilnYaml(appDir, kilnYaml);
  const { writeFileSync: wfs, mkdirSync: mks } = await import("node:fs");
  mks(join(appDir, "memory"), { recursive: true });
  wfs(join(appDir, "app.yaml"), generateAppYaml(initOptions));
  wfs(join(appDir, "gateway.yaml"), generateGatewayYaml(initOptions));

  console.log(`Domain:   ${chosenDomainConfig?.displayName ?? chosenDomainName}`);
  if (qualityGates.length > 0) {
    console.log("Gates:    " + qualityGates.map((g) => g.name).join(", "));
  }
  console.log(`Provider: ${chosenProvider}`);
  console.log(`Channels: ${chosenChannels.join(", ")}`);
  console.log("Kiln initialized.");

  return kilnYaml;
}
