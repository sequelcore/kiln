import { z } from "zod";

export const APP_GATEWAY_CONTROL_PROTOCOL_VERSION = "1" as const;
export const APP_GATEWAY_SERVICE = "kiln-app-gateway" as const;
export const APP_GATEWAY_HEALTH_PATH = "/__kiln/control/app-gateway/health" as const;
export const APP_GATEWAY_SHUTDOWN_PATH = "/__kiln/control/app-gateway/shutdown" as const;

const portableIdentifier = z
  .string()
  .min(1)
  .max(127)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const AppGatewayRuntimeIdentitySchema = z
  .object({
    protocolVersion: z.literal(APP_GATEWAY_CONTROL_PROTOCOL_VERSION),
    service: z.literal(APP_GATEWAY_SERVICE),
    instanceId: portableIdentifier,
    version: z.string().min(1).max(127).regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u),
    pid: z.number().int().positive(),
    startedAt: z.number().int().nonnegative(),
    port: z.number().int().min(1).max(65_535),
    configurationRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    lifecycle: z.enum(["ready", "draining"]),
  })
  .strict();

export type AppGatewayRuntimeIdentity = z.infer<typeof AppGatewayRuntimeIdentitySchema>;
