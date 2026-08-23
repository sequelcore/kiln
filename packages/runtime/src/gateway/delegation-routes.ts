// Gateway: Delegation routes -- Hono sub-app for cross-app cognitive delegation

import { Hono } from "hono";
import type { DelegationRegistry } from "./delegation-handler.js";
import { executeDelegation } from "./delegation-handler.js";
import type { AppDelegation, DelegationErrorCode } from "@kilnai/core";

type DelegateRequest = AppDelegation;

export interface DelegationRoutesConfig {
  readonly registry: DelegationRegistry;
}

const DELEGATE_REQUEST_FIELDS = new Set<keyof AppDelegation>([
  "fromApp",
  "toApp",
  "task",
  "schema",
  "context",
  "priority",
  "timeout",
]);

const ERROR_CODE_TO_STATUS: Record<DelegationErrorCode, number> = {
  TARGET_APP_NOT_FOUND: 404,
  TIMEOUT: 408,
  SCHEMA_VALIDATION_FAILED: 422,
  TARGET_APP_NOT_READY: 503,
  PROVIDER_ERROR: 502,
};

export function createDelegationRoutes(config: DelegationRoutesConfig): Hono {
  const app = new Hono();

  app.post("/delegate", async (c) => {
    let body: DelegateRequest;
    try {
      body = await c.req.json<DelegateRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const unknownField = Object.keys(body).find(
      (field): field is keyof AppDelegation => !DELEGATE_REQUEST_FIELDS.has(field as keyof AppDelegation),
    );
    if (unknownField !== undefined) {
      return c.json({ error: `Unknown field: ${unknownField}` }, 400);
    }

    if (!body.fromApp || typeof body.fromApp !== "string") {
      return c.json({ error: "fromApp is required" }, 400);
    }
    if (!body.toApp || typeof body.toApp !== "string") {
      return c.json({ error: "toApp is required" }, 400);
    }
    if (!body.task || typeof body.task !== "string") {
      return c.json({ error: "task is required" }, 400);
    }
    if (
      body.schema === null ||
      body.schema === undefined ||
      typeof body.schema !== "object" ||
      Array.isArray(body.schema)
    ) {
      return c.json({ error: "schema is required" }, 400);
    }

    const result = await executeDelegation(body, config.registry);

    if ("code" in result) {
      const status = (ERROR_CODE_TO_STATUS[result.code] ?? 500) as Parameters<typeof c.json>[1];
      return c.json({ error: result.message, code: result.code }, status);
    }

    return c.json(result, 200);
  });

  app.get("/delegation-targets", (c) => {
    return c.json({ targets: Array.from(config.registry.targets.keys()) });
  });

  return app;
}
