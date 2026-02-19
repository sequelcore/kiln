// Engine type: GatewayConfig -- multi-app gateway configuration
// Declares which Apps to host and how they bind to channels

/** Channel binding for a specific platform adapter */
export interface GatewayChannelBinding {
  readonly type: string;
  readonly path?: string;
  readonly phoneNumber?: string;
  readonly botToken?: string;
  readonly multiTenant?: boolean;
  readonly verifyTokenEnv?: string;
  readonly adminTokenEnv?: string;
  readonly [key: string]: unknown;
}

/** App binding: name, config path, optional workspace, and channel bindings */
export interface GatewayAppBinding {
  readonly name: string;
  readonly config: string;
  readonly workspace?: string;
  readonly channels: readonly GatewayChannelBinding[];
}

/** Top-level gateway configuration: port + multiple app bindings */
export interface GatewayConfig {
  readonly port: number;
  readonly apps: readonly GatewayAppBinding[];
}

/** Validation error for gateway configuration */
export interface GatewayValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a GatewayConfig. Returns array of errors; empty means valid. */
export function validateGatewayConfig(config: GatewayConfig): GatewayValidationError[] {
  const errors: GatewayValidationError[] = [];

  // Port must be a positive integer in valid TCP range
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push({ field: "port", message: "must be an integer between 1 and 65535" });
  }

  // Apps array must be non-empty
  if (!config.apps || config.apps.length === 0) {
    errors.push({ field: "apps", message: "must have at least one app" });
    return errors;
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  const seenPhoneNumbers = new Set<string>();

  for (let i = 0; i < config.apps.length; i++) {
    const app = config.apps[i]!;
    const prefix = `apps[${i}]`;

    if (!app.name || typeof app.name !== "string") {
      errors.push({ field: `${prefix}.name`, message: "must be a non-empty string" });
    } else if (seenNames.has(app.name)) {
      errors.push({ field: `${prefix}.name`, message: `duplicate app name "${app.name}"` });
    } else {
      seenNames.add(app.name);
    }

    if (!app.config || typeof app.config !== "string") {
      errors.push({ field: `${prefix}.config`, message: "must be a non-empty string" });
    }

    if (!app.channels || app.channels.length === 0) {
      errors.push({ field: `${prefix}.channels`, message: "must have at least one channel binding" });
    } else {
      for (let j = 0; j < app.channels.length; j++) {
        const channel = app.channels[j]!;
        const channelPrefix = `${prefix}.channels[${j}]`;

        if (channel.path && typeof channel.path === "string") {
          if (seenPaths.has(channel.path)) {
            errors.push({ field: `${channelPrefix}.path`, message: `duplicate API path "${channel.path}"` });
          } else {
            seenPaths.add(channel.path);
          }
        }

        if (channel.phoneNumber && typeof channel.phoneNumber === "string") {
          if (seenPhoneNumbers.has(channel.phoneNumber)) {
            errors.push({ field: `${channelPrefix}.phoneNumber`, message: `duplicate phone number "${channel.phoneNumber}"` });
          } else {
            seenPhoneNumbers.add(channel.phoneNumber);
          }
        }
      }
    }
  }

  return errors;
}
