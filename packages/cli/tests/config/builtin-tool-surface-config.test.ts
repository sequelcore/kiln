import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../../src/config/builtin-tool-surface-config.js";
import type { KilnAppConfig } from "../../src/config.js";

vi.mock("@kilnai/runtime", () => ({
  PlaywrightBrowserCaptureRecorder: class MockPlaywrightBrowserCaptureRecorder {
    constructor(readonly options?: unknown) {}
  },
  PlaywrightBrowserUseProvider: class MockPlaywrightBrowserUseProvider {
    constructor(readonly options?: unknown) {}
    execute() {
      return undefined;
    }
  },
}));

describe("builtin tool surface config", () => {
  it("shares the same artifact store between browser tools and the Playwright recorder", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-builtin-recorder-"));
    try {
      const appConfig: KilnAppConfig = {
        createRegistry: () => ({} as never),
        kilnYaml: {
          version: "1",
          interactiveUse: {
            enabled: true,
            browserProvider: "playwright",
            allowedDomains: ["example.com"],
          },
        },
      };

      const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig, projectPath);
      const provider = options.browserUse?.provider as {
        readonly options?: {
          readonly captureRecorder?: {
            readonly options?: {
              readonly artifactStore?: unknown;
            };
          };
        };
      };

      expect(options.artifactResources?.store).toBeDefined();
      expect(provider.options?.captureRecorder?.options?.artifactStore)
        .toBe(options.artifactResources?.store);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
