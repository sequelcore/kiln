import {
  BrowserClickTool,
  BrowserKeypressTool,
  BrowserNavigateTool,
  BrowserObserveTool,
  BrowserScrollTool,
  BrowserSessionStartTool,
  BrowserSessionStopTool,
  BrowserTypeTool,
  ComputerClickTool,
  ComputerCloseApplicationTool,
  ComputerKeypressTool,
  ComputerObserveTool,
  ComputerTypeTool,
  type InteractiveUseProvider,
} from "../../../src/tools/infrastructure/interactive-use-tool.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";
import { describe, expect, it, vi } from "vitest";

describe("interactive use tools", () => {
  it("allows browser_session_start to attach to a known browser session id", () => {
    const tool = new BrowserSessionStartTool();

    expect(tool.inputSchema).toMatchObject({
      properties: {
        sessionId: expect.objectContaining({
          type: "string",
        }),
      },
    });
  });

  it("fail closed when no browser provider is configured", async () => {
    const tool = new BrowserNavigateTool();

    const result = await tool.execute({
      name: "browser_navigate",
      input: { url: "https://example.com" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toBe("Browser use provider is not configured");
    expect(result.metadata).toMatchObject({
      toolName: "browser_navigate",
      kind: "interactive",
      target: "browser",
      operation: "navigate",
      errorCode: "provider_not_configured",
    });
  });

  it("routes browser actions through the configured provider", async () => {
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async (request) => ({
        sessionId: request.sessionId ?? "browser-1",
        provider: "test-browser",
        observation: {
          url: request.url ?? "https://example.com",
          title: "Example",
          screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
        },
        output: "navigated",
      })),
    };
    const tool = new BrowserNavigateTool({ provider });

    const result = await tool.execute({
      name: "browser_navigate",
      input: { sessionId: "browser-1", url: "https://example.com", timeout: 1000 },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("navigated");
    expect(result.metadata).toMatchObject({
      toolName: "browser_navigate",
      kind: "interactive",
      target: "browser",
      operation: "navigate",
      provider: "test-browser",
      sessionId: "browser-1",
      action: {
        type: "navigate",
        url: "https://example.com",
      },
      observation: {
        url: "https://example.com",
        title: "Example",
        screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
      },
      timeoutMs: 1000,
    });
    expect(provider.execute).toHaveBeenCalledWith(expect.objectContaining({
      target: "browser",
      operation: "navigate",
      sessionId: "browser-1",
      url: "https://example.com",
      timeoutMs: 1000,
    }));
  });

  it("marks sensitive type actions in metadata without echoing text", async () => {
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async () => ({
        sessionId: "browser-1",
        provider: "test-browser",
        output: "typed",
      })),
    };
    const tool = new BrowserTypeTool({ provider });

    const result = await tool.execute({
      name: "browser_type",
      input: { sessionId: "browser-1", text: "secret-token", sensitive: true },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("typed");
    expect(JSON.stringify(result.metadata)).not.toContain("secret-token");
    expect(result.metadata).toMatchObject({
      toolName: "browser_type",
      kind: "interactive",
      target: "browser",
      operation: "type",
      action: {
        type: "type",
        textLength: 12,
        sensitive: true,
      },
      sensitive: true,
      requiresApproval: true,
    });
  });

  it("routes computer actions through a separate provider target", async () => {
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async () => ({
        provider: "test-computer",
        output: "observed",
        observation: {
          windowTitle: "Calculator",
          screenshotUri: "kiln://artifacts/interactive/computer/screenshot",
        },
      })),
    };
    const tool = new ComputerObserveTool({ provider });

    const result = await tool.execute({
      name: "computer_observe",
      input: { windowTitle: "Calculator" },
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      toolName: "computer_observe",
      kind: "interactive",
      target: "computer",
      operation: "observe",
      provider: "test-computer",
      observation: {
        windowTitle: "Calculator",
        screenshotUri: "kiln://artifacts/interactive/computer/screenshot",
      },
    });
    expect(provider.execute).toHaveBeenCalledWith(expect.objectContaining({
      target: "computer",
      operation: "observe",
      windowTitle: "Calculator",
    }));
  });

  it("includes computer close method in default output and metadata", async () => {
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async () => ({
        provider: "test-computer",
        observation: {
          application: "Calculator",
          windowTitle: "Calculator",
          closeMethod: "win32-sc-close",
        },
      })),
    };
    const tool = new ComputerCloseApplicationTool({ provider });

    const result = await tool.execute({
      name: "computer_close_application",
      input: { application: "Calculator" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("close_application: Calculator (win32-sc-close)");
    expect(result.metadata).toMatchObject({
      toolName: "computer_close_application",
      kind: "interactive",
      target: "computer",
      operation: "close_application",
      observation: {
        application: "Calculator",
        windowTitle: "Calculator",
        closeMethod: "win32-sc-close",
      },
    });
  });

  it("stores screenshot data URLs as session artifacts instead of transcript metadata", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async () => ({
        sessionId: "browser-1",
        provider: "test-browser",
        output: "observed",
        observation: {
          url: "https://example.com",
          title: "Example",
          screenshotDataUrl: "data:image/png;base64,AQID",
        },
      })),
    };
    const tool = new BrowserObserveTool({ provider, artifactStore });

    const result = await tool.execute({
      name: "browser_observe",
      input: { sessionId: "browser-1", includeScreenshot: true },
    });

    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.metadata)).not.toContain("screenshotDataUrl");
    expect(result.metadata).toMatchObject({
      observation: {
        url: "https://example.com",
        title: "Example",
        screenshotUri: expect.stringMatching(/^kiln:\/\/artifacts\/interactive-screenshots\/artifact_\d+\/content$/),
      },
      resourceLinks: [
        expect.objectContaining({
          relation: "snapshot",
          mimeType: "image/png",
        }),
      ],
    });
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "resource_link",
        mimeType: "image/png",
      }),
    ]);

    const artifact = artifactStore.get("interactive-screenshots", "artifact_1");
    expect(artifact).toMatchObject({
      title: "browser_observe screenshot",
      mimeType: "image/png",
      content: {
        type: "blob",
        blob: "AQID",
      },
    });
  });

  it("passes a session artifact sink to providers that emit live browser frames", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    let sink: {
      writeInteractiveArtifact(input: {
        readonly sessionId: string;
        readonly kind: "screenshot";
        readonly mimeType: string;
        readonly content: Uint8Array;
      }): Promise<string>;
    } | undefined;
    const provider: InteractiveUseProvider & { setInteractiveArtifactSink(next: typeof sink): void } = {
      setInteractiveArtifactSink: vi.fn((next) => {
        sink = next;
      }),
      execute: vi.fn(async (request) => {
        const liveFrameUri = await sink?.writeInteractiveArtifact({
          sessionId: request.sessionId ?? "browser-live",
          kind: "screenshot",
          mimeType: "image/png",
          content: new Uint8Array([4, 5, 6]),
        });
        return {
          sessionId: request.sessionId ?? "browser-live",
          provider: "test-browser",
          output: liveFrameUri ?? "missing live frame sink",
        };
      }),
    };
    const tool = new BrowserSessionStartTool({ provider, artifactStore });

    const result = await tool.execute({
      name: "browser_session_start",
      input: { sessionId: "browser-live" },
    });

    expect(provider.setInteractiveArtifactSink).toHaveBeenCalledWith(expect.objectContaining({
      writeInteractiveArtifact: expect.any(Function),
    }));
    expect(result.output).toMatch(/^kiln:\/\/artifacts\/interactive-screenshots\/artifact_\d+\/content$/);
    expect(artifactStore.get("interactive-screenshots", "artifact_1")).toMatchObject({
      title: "Live browser screenshot",
      mimeType: "image/png",
      content: {
        type: "blob",
        blob: "BAUG",
      },
    });
  });

  it("labels browser screenshot resource links with stable capture sequence metadata", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    let capture = 0;
    const provider: InteractiveUseProvider = {
      execute: vi.fn(async () => {
        capture += 1;
        return {
          sessionId: "browser-1",
          provider: "test-browser",
          output: `observed ${capture}`,
          observation: {
            url: `https://example.com/${capture}`,
            title: `Example ${capture}`,
            screenshotDataUrl: `data:image/png;base64,AQID${capture}`,
          },
        };
      }),
    };
    const tool = new BrowserObserveTool({ provider, artifactStore });

    const first = await tool.execute({
      name: "browser_observe",
      input: { sessionId: "browser-1", includeScreenshot: true },
    });
    const second = await tool.execute({
      name: "browser_observe",
      input: { sessionId: "browser-1", includeScreenshot: true },
    });

    expect(first.metadata?.resourceLinks?.[0]).toMatchObject({
      relation: "snapshot",
      sequence: 1,
      label: "Capture 1",
    });
    expect(second.metadata?.resourceLinks?.[0]).toMatchObject({
      relation: "snapshot",
      sequence: 2,
      label: "Capture 2",
    });
  });

  it("constructs every browser and computer tool", () => {
    expect([
      new BrowserSessionStartTool().name,
      new BrowserNavigateTool().name,
      new BrowserObserveTool().name,
      new BrowserClickTool().name,
      new BrowserTypeTool().name,
      new BrowserKeypressTool().name,
      new BrowserScrollTool().name,
      new BrowserSessionStopTool().name,
      new ComputerObserveTool().name,
      new ComputerClickTool().name,
      new ComputerTypeTool().name,
      new ComputerKeypressTool().name,
      new ComputerCloseApplicationTool().name,
    ]).toEqual([
      "browser_session_start",
      "browser_navigate",
      "browser_observe",
      "browser_click",
      "browser_type",
      "browser_keypress",
      "browser_scroll",
      "browser_session_stop",
      "computer_observe",
      "computer_click",
      "computer_type",
      "computer_keypress",
      "computer_close_application",
    ]);
  });
});
