// Engine loader: EventsLoader -- parses events config from App YAML
// Extracts the optional events section from the same YAML as parseAppYaml()

import { parse } from "yaml";
import type { EventsConfig } from "./events-config.js";

/**
 * Parse a YAML string and extract the events config.
 * Returns undefined if no events section is present.
 */
export function parseEventsConfig(content: string): EventsConfig | undefined {
  let data: unknown;
  try {
    data = parse(content);
  } catch {
    return undefined;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const raw = data as Record<string, unknown>;
  if (!raw.events || typeof raw.events !== "object" || Array.isArray(raw.events)) {
    return undefined;
  }

  const rawEvents = raw.events as Record<string, unknown>;
  const webhook = typeof rawEvents.webhook === "string" ? rawEvents.webhook : "";
  if (!webhook) return undefined;

  let headers: Record<string, string> | undefined;
  if (rawEvents.headers && typeof rawEvents.headers === "object" && !Array.isArray(rawEvents.headers)) {
    headers = {};
    for (const [key, value] of Object.entries(rawEvents.headers as Record<string, unknown>)) {
      if (typeof value === "string") headers[key] = value;
    }
  }

  return { webhook, ...(headers ? { headers } : {}) };
}
