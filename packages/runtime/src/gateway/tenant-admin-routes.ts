// Gateway: Tenant admin CRUD routes -- Hono sub-app for managing tenant configs
// Handles tenant listing, creation, update, and deletion with optional auth

import { Hono } from "hono";
import type { TenantConfig } from "@kilnai/core";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { TenantNotFoundError, TenantValidationFailedError } from "../tenant/tenant-registry.js";
import type { SessionRegistry } from "../session/session-registry.js";
import { requireBearer } from "./auth-middleware.js";

/**
 * Mutable fields allowed in tenant create/update requests.
 * Immutable fields (tenantId, appName, createdAt, updatedAt) are set server-side.
 * This prevents prototype pollution and field injection from untrusted request bodies.
 */
const MUTABLE_TENANT_FIELDS = [
  "name",
  "businessName",
  "description",
  "services",
  "hours",
  "faqEntries",
  "escalationContact",
  "tone",
  "language",
  "whatsappPhoneNumberId",
  "whatsappAccessToken",
  "whatsappVerifyToken",
  "widgetId",
  "allowedOrigins",
  "greeting",
  "billing",
  "idleTimeoutMs",
  "enabled",
  "tools",
  "toolConfig",
  "webhookTools",
  "integrations",
  "agents",
  "routing",
  "instagramPageId",
  "instagramAccessToken",
  "messengerPageId",
  "messengerAccessToken",
  "emailAddress",
  "emailFromAddress",
  "emailFromName",
  "emailTransportConfig",
  "modelConfig",
  "preChatForm",
  "groundingMode",
  "sessionLimits",
  "whatsappCoexistence",
] as const satisfies readonly (keyof TenantConfig)[];

/** Pick only safe mutable fields from an untrusted body */
function pickMutableFields(body: Record<string, unknown>): Partial<TenantConfig> {
  const result: Record<string, unknown> = {};
  for (const field of MUTABLE_TENANT_FIELDS) {
    if (field in body) {
      result[field] = body[field];
    }
  }
  return result as Partial<TenantConfig>;
}

export interface TenantAdminRoutesConfig {
  readonly tenantRegistry: TenantRegistry;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly adminToken?: string;
}

/**
 * Generate a tenant ID from a display name.
 * Lowercases, removes diacritics (NFD + strip combining chars),
 * replaces non-alphanumeric with hyphens, trims hyphens, max 64 chars.
 */
export function generateTenantId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function createTenantAdminRoutes(config: TenantAdminRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // GET /tenants -- list tenants for this App
  app.get("/tenants", (c) => {
    const tenants = config.tenantRegistry.list(config.appName);
    return c.json({ tenants });
  });

  // GET /tenants/:tenantId -- get single tenant
  app.get("/tenants/:tenantId", (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = config.tenantRegistry.get(tenantId);
    if (!tenant || tenant.appName !== config.appName) {
      return c.json({ error: "Tenant not found" }, 404);
    }
    return c.json(tenant);
  });

  // POST /tenants -- create tenant
  app.post("/tenants", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const now = new Date().toISOString();
    const tenantId = (body.tenantId as string) || generateTenantId((body.name as string) ?? "");
    const safeFields = pickMutableFields(body);

    const tenantConfig: TenantConfig = {
      ...safeFields,
      tenantId,
      appName: config.appName,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      createdAt: now,
      updatedAt: now,
    } as TenantConfig;

    try {
      const created = config.tenantRegistry.create(tenantConfig);
      return c.json(created, 201);
    } catch (err) {
      if (err instanceof TenantValidationFailedError) {
        const isDuplicate = err.errors.some((e) => e.message.includes("duplicate"));
        if (isDuplicate) {
          return c.json({ error: "Tenant already exists", details: err.errors }, 409);
        }
        return c.json({ error: "Validation failed", details: err.errors }, 422);
      }
      throw err;
    }
  });

  // PATCH /tenants/:tenantId -- partial update
  app.patch("/tenants/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const safeUpdate = pickMutableFields(body);
      const updated = config.tenantRegistry.update(tenantId, safeUpdate);
      await config.sessionRegistry.invalidateByTenant(config.appName, tenantId);
      return c.json(updated);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return c.json({ error: "Tenant not found" }, 404);
      }
      if (err instanceof TenantValidationFailedError) {
        return c.json({ error: "Validation failed", details: err.errors }, 422);
      }
      throw err;
    }
  });

  // DELETE /tenants/:tenantId -- remove tenant
  app.delete("/tenants/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = config.tenantRegistry.get(tenantId);
    if (!tenant || tenant.appName !== config.appName) {
      return c.json({ error: "Tenant not found" }, 404);
    }
    config.tenantRegistry.remove(tenantId);
    await config.sessionRegistry.invalidateByTenant(config.appName, tenantId);
    return c.json({ removed: true });
  });

  return app;
}
