import { afterEach, describe, expect, it } from "vitest";
import {
  resolveEffectiveModel,
  resolveEffectiveProvider,
  resolveEnvModel,
  resolveEnvProvider,
} from "./env-config.js";

const originalProvider = process.env.KILN_PROVIDER;
const originalModel = process.env.KILN_MODEL;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.KILN_PROVIDER;
  } else {
    process.env.KILN_PROVIDER = originalProvider;
  }

  if (originalModel === undefined) {
    delete process.env.KILN_MODEL;
  } else {
    process.env.KILN_MODEL = originalModel;
  }
});

describe("resolveEnvProvider", () => {
  it("returns undefined when KILN_PROVIDER is not set", () => {
    delete process.env.KILN_PROVIDER;
    expect(resolveEnvProvider()).toBeUndefined();
  });

  it("returns value when KILN_PROVIDER is set", () => {
    process.env.KILN_PROVIDER = "openai";
    expect(resolveEnvProvider()).toBe("openai");
  });

  it("returns undefined when KILN_PROVIDER is empty string", () => {
    process.env.KILN_PROVIDER = "";
    expect(resolveEnvProvider()).toBeUndefined();
  });
});

describe("resolveEnvModel", () => {
  it("returns undefined when KILN_MODEL is not set", () => {
    delete process.env.KILN_MODEL;
    expect(resolveEnvModel()).toBeUndefined();
  });

  it("returns value when KILN_MODEL is set", () => {
    process.env.KILN_MODEL = "gpt-5.4";
    expect(resolveEnvModel()).toBe("gpt-5.4");
  });

  it("returns undefined when KILN_MODEL is empty string", () => {
    process.env.KILN_MODEL = "";
    expect(resolveEnvModel()).toBeUndefined();
  });
});

describe("resolveEffectiveProvider", () => {
  it("flag wins over env over global", () => {
    process.env.KILN_PROVIDER = "openai";
    expect(resolveEffectiveProvider("claude", "ollama")).toBe("claude");
  });

  it("falls back to env when no flag", () => {
    process.env.KILN_PROVIDER = "openrouter";
    expect(resolveEffectiveProvider(undefined, "ollama")).toBe("openrouter");
  });

  it("falls back to global when no flag and no env", () => {
    delete process.env.KILN_PROVIDER;
    expect(resolveEffectiveProvider(undefined, "deepseek")).toBe("deepseek");
  });

  it("returns undefined when all are absent", () => {
    delete process.env.KILN_PROVIDER;
    expect(resolveEffectiveProvider()).toBeUndefined();
  });
});

describe("resolveEffectiveModel", () => {
  it("uses flag first", () => {
    process.env.KILN_MODEL = "env-model";
    expect(resolveEffectiveModel("flag-model", "global-model")).toBe("flag-model");
  });

  it("falls back to env when no flag", () => {
    process.env.KILN_MODEL = "env-model";
    expect(resolveEffectiveModel(undefined, "global-model")).toBe("env-model");
  });

  it("falls back to global when no flag and no env", () => {
    delete process.env.KILN_MODEL;
    expect(resolveEffectiveModel(undefined, "global-model")).toBe("global-model");
  });
});
