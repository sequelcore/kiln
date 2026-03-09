import { describe, it, expect } from "vitest";
import type { TenantConfig, PreChatFormConfig } from "../../../src/engine/gateway/tenant-config.js";
import { validateTenantConfig } from "../../../src/engine/gateway/tenant-config.js";

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "salon-maria",
    appName: "atendia",
    name: "Salon Maria",
    enabled: true,
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makePreChatForm(overrides: Partial<PreChatFormConfig> = {}): PreChatFormConfig {
  return {
    enabled: true,
    fields: [
      { key: "name", label: "Your name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: false },
    ],
    ...overrides,
  };
}

describe("TenantConfig preChatForm validation", () => {
  it("accepts valid preChatForm config", () => {
    const errors = validateTenantConfig(makeTenantConfig({ preChatForm: makePreChatForm() }));
    expect(errors).toEqual([]);
  });

  it("accepts disabled form with empty fields", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: { enabled: false, fields: [] },
    }));
    expect(errors).toEqual([]);
  });

  it("rejects enabled form with no fields", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: { enabled: true, fields: [] },
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields",
      message: "must have at least one field when enabled",
    });
  });

  it("rejects more than 10 fields", () => {
    const fields = Array.from({ length: 11 }, (_, i) => ({
      key: `field${i}`, label: `Field ${i}`, type: "text" as const, required: false,
    }));
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: { enabled: true, fields },
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields",
      message: "must not exceed 10 fields",
    });
  });

  it("rejects duplicate field keys", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "name", label: "Full Name", type: "text", required: false },
        ],
      }),
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields[1].key",
      message: 'duplicate field key: "name"',
    });
  });

  it("rejects invalid field type", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({
        fields: [
          { key: "custom", label: "Custom", type: "number" as "text", required: false },
        ],
      }),
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields[0].type",
      message: "must be one of: text, email, phone",
    });
  });

  it("rejects empty field key", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({
        fields: [{ key: "", label: "Name", type: "text", required: true }],
      }),
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields[0].key",
      message: "must be a non-empty string",
    });
  });

  it("rejects non-boolean enabled", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: { enabled: "yes" as unknown as boolean, fields: [] },
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.enabled",
      message: "must be a boolean",
    });
  });

  it("rejects non-boolean required on field", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({
        fields: [{ key: "name", label: "Name", type: "text", required: "yes" as unknown as boolean }],
      }),
    }));
    expect(errors).toContainEqual({
      field: "preChatForm.fields[0].required",
      message: "must be a boolean",
    });
  });

  it("accepts all valid field types", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: false },
          { key: "phone", label: "Phone", type: "phone", required: false },
        ],
      }),
    }));
    expect(errors).toEqual([]);
  });

  it("accepts config without preChatForm", () => {
    const errors = validateTenantConfig(makeTenantConfig());
    expect(errors).toEqual([]);
  });

  it("accepts preChatForm with submitLabel", () => {
    const errors = validateTenantConfig(makeTenantConfig({
      preChatForm: makePreChatForm({ submitLabel: "Begin" }),
    }));
    expect(errors).toEqual([]);
  });
});
