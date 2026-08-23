import { isMap, isSeq, parseDocument } from "yaml";
import { AppLoaderError, parseAppYaml } from "./app-loader.js";

export interface AppScheduleTriggerInput {
  readonly name: string;
  readonly cron: string;
  readonly task: string;
  readonly timezone: string;
}

export type AppConfigMutationResult =
  | { readonly changed: true; readonly bytes: string }
  | { readonly changed: false; readonly bytes: string; readonly reason: "duplicate" | "not-found" };

/** Adds one schedule by mutating only the triggers AST owned by app configuration. */
export function addAppScheduleTrigger(
  content: string,
  input: AppScheduleTriggerInput,
  sourcePath = "app.yaml",
): AppConfigMutationResult {
  const app = parseAppYaml(content, sourcePath);
  if (app.triggers?.some((trigger) => trigger.name === input.name)) {
    return { changed: false, bytes: content, reason: "duplicate" };
  }

  const document = parseMutableDocument(content, sourcePath);
  let triggers = document.get("triggers", true);
  if (triggers === undefined || triggers === null) {
    document.set("triggers", []);
    triggers = document.get("triggers", true);
  }
  if (!isSeq(triggers)) {
    throw new AppLoaderError([{ field: "triggers", message: "must be an array" }], sourcePath);
  }
  triggers.add({
    name: input.name,
    type: "schedule",
    team: app.router.fallback,
    cron: input.cron,
    task: input.task,
    timezone: input.timezone,
  });
  const bytes = document.toString();
  parseAppYaml(bytes, sourcePath);
  return { changed: true, bytes };
}

/** Removes one schedule by mutating only its triggers sequence entry. */
export function removeAppScheduleTrigger(
  content: string,
  name: string,
  sourcePath = "app.yaml",
): AppConfigMutationResult {
  parseAppYaml(content, sourcePath);
  const document = parseMutableDocument(content, sourcePath);
  const triggers = document.get("triggers", true);
  if (!isSeq(triggers)) return { changed: false, bytes: content, reason: "not-found" };
  const index = triggers.items.findIndex((item) => isMap(item) && item.get("name") === name);
  if (index < 0) return { changed: false, bytes: content, reason: "not-found" };
  triggers.delete(index);
  if (triggers.items.length === 0) document.delete("triggers");
  const bytes = document.toString();
  parseAppYaml(bytes, sourcePath);
  return { changed: true, bytes };
}

function parseMutableDocument(content: string, sourcePath: string) {
  const document = parseDocument(content);
  if (document.errors.length > 0) {
    throw new AppLoaderError(
      document.errors.map((error) => ({ field: "yaml", message: error.message })),
      sourcePath,
    );
  }
  return document;
}
