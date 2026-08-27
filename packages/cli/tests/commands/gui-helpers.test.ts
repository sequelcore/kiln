import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("gui command helpers", () => {
  it("adds a query only for an explicit launch override", async () => {
    const { buildGuiAttachUrl, buildGuiUrl } = await import("../../src/commands/gui-options.js");

    expect(buildGuiUrl("http://localhost:5183/gui/")).toBe("http://localhost:5183/gui/");
    expect(buildGuiUrl("http://localhost:5183/gui/", "automata")).toBe("http://localhost:5183/gui/?theme=automata");
    expect(buildGuiUrl("http://localhost:5183/gui/", "automata", "operator-secret")).toBe(
      "http://localhost:5183/gui/?theme=automata#operatorToken=operator-secret",
    );
    expect(buildGuiAttachUrl("http://localhost:3800", "automata")).toBe("http://localhost:3800/gui/?theme=automata");
    expect(buildGuiAttachUrl("https://gateway.example.com/apps", "automata")).toBe(
      "https://gateway.example.com/gui/?theme=automata",
    );
    expect(buildGuiAttachUrl("https://gateway.example.com/apps")).toBe("https://gateway.example.com/gui/");
  });

  it("rejects non-http GUI attach URLs", async () => {
    const { buildGuiAttachUrl } = await import("../../src/commands/gui-options.js");

    expect(() => buildGuiAttachUrl("file:///tmp/gui", "phosphor")).toThrow(
      "GUI attach URL must use http:// or https://",
    );
  });

  it("resolves GUI development assets from the running Kiln checkout instead of the target project", async () => {
    const { resolveGuiDevSourceRoot } = await import("../../src/commands/gui-options.js");
    const checkout = resolve("synthetic-kiln-checkout");
    const runningModule = pathToFileURL(join(checkout, "packages", "cli", "dist", "commands", "gui.js")).href;

    expect(resolveGuiDevSourceRoot(runningModule)).toBe(checkout);
  });
});
