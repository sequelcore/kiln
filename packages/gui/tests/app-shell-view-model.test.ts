import { describe, expect, it } from "vitest";
import {
  resolveActiveChatWorkspaceSurface,
  resolveDrawerLabels,
  resolveWorkbenchTitle,
  themeToPaletteItem,
} from "../src/components/app-shell-view-model.js";

describe("app shell view model", () => {
  it("resolves browser chat title only when the browser surface has live context", () => {
    expect(resolveActiveChatWorkspaceSurface({
      workbenchSurface: "chat",
      activeSurface: "browser",
      hasBrowserSession: true,
      hasBrowserSnapshot: false,
    })).toBe("browser");
    expect(resolveWorkbenchTitle("chat", "browser")).toBe("Browser");

    expect(resolveActiveChatWorkspaceSurface({
      workbenchSurface: "chat",
      activeSurface: "browser",
      hasBrowserSession: false,
      hasBrowserSnapshot: false,
    })).toBe("chat");
    expect(resolveWorkbenchTitle("chat", "chat")).toBe("Chat");
    expect(resolveWorkbenchTitle("memory", "chat")).toBe("Memory");
  });

  it("resolves drawer labels from drawer mode", () => {
    expect(resolveDrawerLabels("sessions")).toEqual({
      title: "Sessions",
      description: "Session history and continuation targets.",
      ariaLabel: "Sessions drawer",
      closeLabel: "Close session drawer",
    });
    expect(resolveDrawerLabels("inspector")).toMatchObject({
      title: "Inspector",
      ariaLabel: "Inspector drawer",
    });
  });

  it("keeps theme command copy compatible with the command palette", () => {
    expect(themeToPaletteItem("graphite", "Graphite")).toEqual({
      id: "theme:graphite",
      trigger: "theme graphite",
      title: "Graphite",
      description: "Apply graphite.",
      keywords: ["theme", "graphite", "graphite"],
    });
  });
});
