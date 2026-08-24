import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAppScheduleTrigger, removeAppScheduleTrigger } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";

export async function cronCommand(
  _appConfig: KilnAppConfig,
  projectPath: string | undefined,
  args: string[],
): Promise<void> {
  const root = projectPath ?? process.cwd();
  const appYamlPath = join(root, "app.yaml");

  const subcommand = args[0] ?? "";

  switch (subcommand) {
    case "list":
      await listCommand(appYamlPath);
      break;
    case "add":
      await addCommand(appYamlPath, args.slice(1));
      break;
    case "remove":
      removeCommand(appYamlPath, args.slice(1));
      break;
    case "run":
      await runCommand(appYamlPath, args.slice(1));
      break;
    default:
      printCronHelp();
  }
}

async function listCommand(appYamlPath: string): Promise<void> {
  const { parseAppYaml } = await import("@kilnai/core");
  const { EventBus } = await import("@kilnai/core");
  const { Scheduler } = await import("@kilnai/runtime");

  if (!existsSync(appYamlPath)) {
    console.log("No app.yaml found. Create or select an app configuration first.");
    return;
  }

  const raw = readFileSync(appYamlPath, "utf-8");
  const app = parseAppYaml(raw);

  const eventBus = new EventBus();
  const scheduler = new Scheduler({ appName: "cli", eventBus });

  if (app.triggers) {
    for (const trigger of app.triggers) {
      if (trigger.type === "schedule") {
        scheduler.register(trigger);
      }
    }
  }

  const entries = scheduler.list();

  if (entries.length === 0) {
    console.log("No schedules configured.");
    return;
  }

  const nameWidth = Math.max(entries.reduce((w, e) => Math.max(w, e.trigger.name.length), 10), 10);
  const cronWidth = Math.max(entries.reduce((w, e) => Math.max(w, e.trigger.cron.length), 10), 10);

  console.log("");
  console.log(
    `  ${"NAME".padEnd(nameWidth)} ${"CRON".padEnd(cronWidth)} ${"TIMEZONE".padEnd(18)} ${"NEXT RUN".padEnd(25)} ENABLED`,
  );
  console.log(
    `  ${"".padEnd(nameWidth, "-")} ${"".padEnd(cronWidth, "-")} ${"".padEnd(18, "-")} ${"".padEnd(25, "-")} ${"".padEnd(7, "-")}`,
  );

  for (const entry of entries) {
    const tz = entry.trigger.timezone ?? "UTC";
    const nextStr = entry.nextFireAt.toISOString().replace("T", " ").slice(0, 19);
    const enabled = entry.trigger.enabled !== false ? "true" : "false";
    console.log(
      `  ${entry.trigger.name.padEnd(nameWidth)} ${entry.trigger.cron.padEnd(cronWidth)} ${tz.padEnd(18)} ${nextStr.padEnd(25)} ${enabled}`,
    );
  }

  console.log("");
}

async function addCommand(appYamlPath: string, args: string[]): Promise<void> {
  const name = args[0];
  const cron = args[1];
  const task = args[2];
  let timezone = "UTC";

  for (let i = 3; i < args.length; i++) {
    if (args[i] === "--timezone" && i + 1 < args.length) {
      timezone = args[i + 1]!;
      i++;
    }
  }

  if (!name || !cron || !task) {
    console.error("Usage: kiln cron add <name> <cron> <task> [--timezone <tz>]");
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error(`Invalid schedule name '${name}'. Use only letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }

  const core = await import("@kilnai/core");
  const { validateCronExpression, validateTimezone, nextFireTime, parseCronExpression } = core;

  const cronError = validateCronExpression(cron);
  if (cronError) {
    console.error(`Invalid cron expression: ${cronError}`);
    process.exit(1);
  }

  const tzError = validateTimezone(timezone);
  if (tzError) {
    console.error(tzError);
    process.exit(1);
  }

  if (!existsSync(appYamlPath)) {
    console.error("No app.yaml found. Create or select an app configuration first.");
    process.exit(1);
  }

  const raw = readFileSync(appYamlPath, "utf-8");
  const mutation = addAppScheduleTrigger(raw, { name, cron, task, timezone }, appYamlPath);
  if (!mutation.changed) {
    console.error(`A schedule named '${name}' already exists in app.yaml.`);
    process.exit(1);
  }
  writeFileSync(appYamlPath, mutation.bytes, "utf-8");

  const expr = parseCronExpression(cron);
  const next = nextFireTime(expr, new Date(), timezone === "UTC" ? undefined : timezone);
  const nextStr = next.toISOString().replace("T", " ").slice(0, 19);
  console.log(`Schedule '${name}' added. Next run: ${nextStr} (${timezone})`);
}

function removeCommand(appYamlPath: string, args: string[]): void {
  const name = args[0];

  if (!name) {
    console.error("Usage: kiln cron remove <name>");
    process.exit(1);
  }

  if (!existsSync(appYamlPath)) {
    console.error("No app.yaml found. Create or select an app configuration first.");
    process.exit(1);
  }

  const raw = readFileSync(appYamlPath, "utf-8");
  const mutation = removeAppScheduleTrigger(raw, name, appYamlPath);
  if (!mutation.changed) {
    console.error(`No schedule named '${name}' found.`);
    process.exit(1);
  }
  writeFileSync(appYamlPath, mutation.bytes, "utf-8");
  console.log(`Schedule '${name}' removed.`);
}

async function runCommand(appYamlPath: string, args: string[]): Promise<void> {
  const name = args[0];

  if (!name) {
    console.error("Usage: kiln cron run <name>");
    process.exit(1);
  }

  const { parseAppYaml } = await import("@kilnai/core");
  const { EventBus } = await import("@kilnai/core");
  const { Scheduler } = await import("@kilnai/runtime");

  if (!existsSync(appYamlPath)) {
    console.error("No app.yaml found. Create or select an app configuration first.");
    process.exit(1);
  }

  const raw = readFileSync(appYamlPath, "utf-8");
  const app = parseAppYaml(raw);

  const eventBus = new EventBus();
  const scheduler = new Scheduler({ appName: "cli", eventBus });

  let found = false;
  if (app.triggers) {
    for (const trigger of app.triggers) {
      if (trigger.type === "schedule") {
        scheduler.register(trigger);
        if (trigger.name === name) found = true;
      }
    }
  }

  if (!found) {
    console.error(`No schedule named '${name}' found.`);
    process.exit(1);
  }

  scheduler.start();
  const fired = await scheduler.fire(name);
  scheduler.stop();

  if (fired) {
    console.log(`Fired '${name}'.`);
  } else {
    console.error(`Schedule '${name}' not found.`);
    process.exit(1);
  }
}

function printCronHelp(): void {
  console.log("\nUsage: kiln cron <subcommand>\n");
  console.log("Subcommands:");
  console.log("  list                           List all schedules");
  console.log("  add <name> <cron> <task>      Add a new schedule");
  console.log("  remove <name>                  Remove a schedule");
  console.log("  run <name>                     Fire a schedule immediately");
  console.log("");
  console.log("Options:");
  console.log("  --timezone <tz>  IANA timezone for 'add' (default: UTC)");
  console.log("");
}
