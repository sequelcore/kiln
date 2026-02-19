import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Must import after mock setup
const { execSync } = await import("node:child_process");
const mockedExecSync = vi.mocked(execSync);

// The module caches identity, so we re-import fresh for each test
async function freshImport() {
  const mod = await import("../../src/memory/developer-identity.js");
  return mod;
}

describe("getDeveloperIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns name and email from git", async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git config user.name") return "Alice\n";
      if (cmd === "git config user.email") return "alice@example.com\n";
      return "";
    });

    const { getDeveloperIdentity } = await freshImport();
    const identity = getDeveloperIdentity();

    expect(identity.name).toBe("Alice");
    expect(identity.email).toBe("alice@example.com");
  });

  it("returns fallback when git fails", async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });

    const { getDeveloperIdentity } = await freshImport();
    const identity = getDeveloperIdentity();

    expect(identity.name).toBe("unknown");
    expect(identity.email).toBe("unknown");
  });
});

describe("generateDeveloperId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("is deterministic (same email -> same ID)", async () => {
    const { generateDeveloperId } = await freshImport();
    const id1 = generateDeveloperId({ name: "Alice", email: "alice@example.com" });
    const id2 = generateDeveloperId({ name: "Alice", email: "alice@example.com" });
    expect(id1).toBe(id2);
  });

  it("produces 8-char hex string", async () => {
    const { generateDeveloperId } = await freshImport();
    const id = generateDeveloperId({ name: "Bob", email: "bob@example.com" });
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("produces different IDs for different emails", async () => {
    const { generateDeveloperId } = await freshImport();
    const id1 = generateDeveloperId({ name: "Alice", email: "alice@example.com" });
    const id2 = generateDeveloperId({ name: "Bob", email: "bob@example.com" });
    expect(id1).not.toBe(id2);
  });
});
