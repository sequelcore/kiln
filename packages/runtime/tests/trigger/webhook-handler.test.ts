import { describe, it, expect } from "vitest";
import { validateWebhookSignature, createWebhookHandler } from "../../src/trigger/webhook-handler.js";
import type { WebhookTrigger } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { createHmac } from "node:crypto";

describe("validateWebhookSignature", () => {
  const secret = "test-secret-key";

  function sign(body: string): string {
    return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  }

  it("returns true for valid signature", () => {
    const body = '{"action":"push"}';
    const signature = sign(body);
    expect(validateWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("returns true for signature without sha256= prefix", () => {
    const body = '{"action":"push"}';
    const rawSig = createHmac("sha256", secret).update(body).digest("hex");
    expect(validateWebhookSignature(body, rawSig, secret)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const body = '{"action":"push"}';
    expect(validateWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const body = '{"action":"push"}';
    const signature = sign(body);
    expect(validateWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("returns false for tampered body", () => {
    const signature = sign('{"action":"push"}');
    expect(validateWebhookSignature('{"action":"hack"}', signature, secret)).toBe(false);
  });

  it("returns false for malformed hex", () => {
    expect(validateWebhookSignature("body", "sha256=not-hex", secret)).toBe(false);
  });
});

describe("createWebhookHandler", () => {
  it("creates routes for webhook triggers", async () => {
    const eventBus = new EventBus();
    const trigger: WebhookTrigger = {
      name: "on-deploy",
      type: "webhook",
      team: "ops",
      task: "Deploy {{payload.url}}",
      path: "/hooks/deploy",
    };

    const app = createWebhookHandler([trigger], { appName: "test-app", eventBus });

    const res = await app.request("/hooks/deploy", {
      method: "POST",
      body: JSON.stringify({ url: "https://prod.example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.team).toBe("ops");
    expect(json.task).toBe("Deploy https://prod.example.com");
  });

  it("returns 401 for invalid signature when secretEnv is set", async () => {
    const eventBus = new EventBus();
    const trigger: WebhookTrigger = {
      name: "secure-hook",
      type: "webhook",
      team: "ops",
      path: "/hooks/secure",
      secretEnv: "WEBHOOK_SECRET",
    };

    // Set the env var
    const originalEnv = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = "my-secret";

    try {
      const app = createWebhookHandler([trigger], { appName: "test-app", eventBus });

      const res = await app.request("/hooks/secure", {
        method: "POST",
        body: JSON.stringify({ data: "test" }),
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=invalid",
        },
      });

      expect(res.status).toBe(401);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.WEBHOOK_SECRET;
      } else {
        process.env.WEBHOOK_SECRET = originalEnv;
      }
    }
  });

  it("returns 200 for valid signature", async () => {
    const eventBus = new EventBus();
    const secret = "valid-secret";
    const trigger: WebhookTrigger = {
      name: "signed-hook",
      type: "webhook",
      team: "ops",
      path: "/hooks/signed",
      secretEnv: "SIGNED_SECRET",
    };

    const originalEnv = process.env.SIGNED_SECRET;
    process.env.SIGNED_SECRET = secret;

    try {
      const app = createWebhookHandler([trigger], { appName: "test-app", eventBus });
      const body = JSON.stringify({ action: "deploy" });
      const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

      const res = await app.request("/hooks/signed", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
        },
      });

      expect(res.status).toBe(200);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SIGNED_SECRET;
      } else {
        process.env.SIGNED_SECRET = originalEnv;
      }
    }
  });

  it("skips disabled triggers", async () => {
    const eventBus = new EventBus();
    const trigger: WebhookTrigger = {
      name: "disabled",
      type: "webhook",
      team: "ops",
      path: "/hooks/disabled",
      enabled: false,
    };

    const app = createWebhookHandler([trigger], { appName: "test-app", eventBus });
    const res = await app.request("/hooks/disabled", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  it("handles PUT method triggers", async () => {
    const eventBus = new EventBus();
    const trigger: WebhookTrigger = {
      name: "put-hook",
      type: "webhook",
      team: "ops",
      path: "/hooks/update",
      method: "PUT",
    };

    const app = createWebhookHandler([trigger], { appName: "test-app", eventBus });
    const res = await app.request("/hooks/update", {
      method: "PUT",
      body: JSON.stringify({ data: "test" }),
    });
    expect(res.status).toBe(200);
  });
});
