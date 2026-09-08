import { describe, expect, it, vi } from "vitest";
import { verifierCommand } from "../../src/commands/verifier.js";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";

const config: KilnGlobalConfig = {
  version: "7",
  verification: { inferential: { gentleAi: { executable: "C:/tools/gentle-ai.exe", expectedVersion: "2.5.0-rc.1" } } },
};
const digest = `sha256:${"ab".repeat(32)}`;

describe("verifier review", () => {
  it.runIf(!process.stdin.isTTY || !process.stdout.isTTY)("never approves through noninteractive input", async () => {
    const publish = vi.fn();
    await expect(verifierCommand(["review", "gentle-ai"], { readConfig: () => config, observe: () => digest, publish })).rejects.toThrow("interactive terminal");
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes only after confirmation and byte revalidation", async () => {
    const publish = vi.fn();
    const observe = vi.fn(() => digest);
    await verifierCommand(["review", "gentle-ai"], {
      readConfig: () => config,
      observe,
      confirm: async () => true,
      publish,
    });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith({
      version: 1,
      selection: { verifier: "gentle-ai", config: config.verification!.inferential!.gentleAi },
      digest,
    });
  });

  it("does not publish declined approval", async () => {
    const publish = vi.fn();
    await verifierCommand(["review", "gentle-ai"], {
      readConfig: () => config,
      observe: () => digest,
      confirm: async () => false,
      publish,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(["selection", "bytes"])("rejects %s drift during review", async (drift) => {
    let confirmed = false;
    const publish = vi.fn();
    await expect(
      verifierCommand(["review", "gentle-ai"], {
        readConfig: () => (confirmed && drift === "selection" ? { version: "7" } : config),
        observe: () => (confirmed && drift === "bytes" ? `sha256:${"cd".repeat(32)}` : digest),
        confirm: async () => {
          confirmed = true;
          return true;
        },
        publish,
      }),
    ).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
});
