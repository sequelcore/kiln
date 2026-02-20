// Engine loader: GatewayLoader -- parses gateway YAML into typed config
// Does NOT load individual App YAML files

import { parse } from "yaml";
import { KilnError } from "../errors.js";
import type { GatewayConfig, GatewayAppBinding, GatewayChannelBinding, GatewayValidationError } from "./gateway-config.js";
import { validateGatewayConfig } from "./gateway-config.js";

/** Error class for gateway YAML loader failures, aggregating all validation errors */
export class GatewayLoaderError extends KilnError {
  readonly errors: readonly GatewayValidationError[];

  constructor(errors: readonly GatewayValidationError[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("GATEWAY_YAML_INVALID", `Invalid gateway YAML:\n${msg}`, {
      context: { errors },
      retryable: false,
    });
    this.name = "GatewayLoaderError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Internal YAML shape types (unvalidated raw structure from parse())
// ---------------------------------------------------------------------------

interface RawChannelBinding {
  type?: unknown;
  path?: unknown;
  phoneNumber?: unknown;
  botToken?: unknown;
  [key: string]: unknown;
}

interface RawAppBinding {
  name?: unknown;
  config?: unknown;
  workspace?: unknown;
  channels?: unknown;
}

interface RawGateway {
  port?: unknown;
  apps?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapChannelBinding(raw: RawChannelBinding): GatewayChannelBinding {
  const binding: Record<string, unknown> = {};

  if (typeof raw.type === "string") binding["type"] = raw.type;
  else binding["type"] = "";

  if (typeof raw.path === "string") binding["path"] = raw.path;
  if (typeof raw.phoneNumber === "string") binding["phoneNumber"] = raw.phoneNumber;
  if (typeof raw.botToken === "string") binding["botToken"] = raw.botToken;

  // Preserve any additional channel-specific keys
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "type" && key !== "path" && key !== "phoneNumber" && key !== "botToken") {
      binding[key] = value;
    }
  }

  return binding as GatewayChannelBinding;
}

function mapAppBinding(raw: RawAppBinding, path: string): { binding: GatewayAppBinding; errors: GatewayValidationError[] } {
  const errors: GatewayValidationError[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }

  if (!raw.config || typeof raw.config !== "string") {
    errors.push({ field: `${path}.config`, message: "must be a non-empty string" });
  }

  const channels: GatewayChannelBinding[] = [];
  if (!raw.channels || !Array.isArray(raw.channels)) {
    errors.push({ field: `${path}.channels`, message: "must be a non-empty array" });
  } else {
    for (const ch of raw.channels) {
      if (ch && typeof ch === "object" && !Array.isArray(ch)) {
        channels.push(mapChannelBinding(ch as RawChannelBinding));
      }
    }
  }

  const binding: GatewayAppBinding = {
    name: typeof raw.name === "string" ? raw.name : "",
    config: typeof raw.config === "string" ? raw.config : "",
    ...(typeof raw.workspace === "string" ? { workspace: raw.workspace } : {}),
    channels,
  };

  return { binding, errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a YAML string into a typed GatewayConfig. Throws GatewayLoaderError if invalid. */
export function parseGatewayYaml(content: string): GatewayConfig {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new GatewayLoaderError([{ field: "yaml", message: String(err) }]);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new GatewayLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawGateway;
  const errors: GatewayValidationError[] = [];

  // port defaults to 4800
  let port = 4800;
  if (raw.port !== undefined) {
    if (typeof raw.port !== "number") {
      errors.push({ field: "port", message: "must be a number" });
    } else {
      port = raw.port;
    }
  }

  // apps
  const apps: GatewayAppBinding[] = [];
  if (!raw.apps || !Array.isArray(raw.apps)) {
    errors.push({ field: "apps", message: "must be a non-empty array" });
  } else {
    for (let i = 0; i < raw.apps.length; i++) {
      const rawApp = raw.apps[i];
      if (!rawApp || typeof rawApp !== "object" || Array.isArray(rawApp)) {
        errors.push({ field: `apps[${i}]`, message: "must be an object" });
        continue;
      }
      const { binding, errors: appErrors } = mapAppBinding(rawApp as RawAppBinding, `apps[${i}]`);
      apps.push(binding);
      errors.push(...appErrors);
    }
  }

  if (errors.length > 0) throw new GatewayLoaderError(errors);

  const config: GatewayConfig = { port, apps };

  const validationErrors = validateGatewayConfig(config);
  if (validationErrors.length > 0) throw new GatewayLoaderError(validationErrors);

  return config;
}
