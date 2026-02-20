import { describe, it, expect } from "vitest";
import { createDevInspectorHtml } from "../../src/gateway/dev-inspector.js";

describe("createDevInspectorHtml", () => {
  const html = createDevInspectorHtml();

  it("returns an HTML string", () => {
    expect(typeof html).toBe("string");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("contains SSE endpoint reference", () => {
    expect(html).toContain("/dev/events");
  });

  it("contains all dev API endpoint references", () => {
    expect(html).toContain("/dev/state");
    expect(html).toContain("/dev/cost");
    expect(html).toContain("/dev/apps");
    expect(html).toContain("/dev/triggers");
  });

  it("contains expected section elements", () => {
    expect(html).toContain("Phase Pipeline");
    expect(html).toContain("Event Stream");
    expect(html).toContain("Security");
  });

  it("contains security stat elements", () => {
    expect(html).toContain("Scans");
    expect(html).toContain("Blocked");
    expect(html).toContain("Guardian Reviews");
    expect(html).toContain("Violations");
  });

  it("has no external dependencies", () => {
    expect(html).not.toContain("cdn.");
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("jsdelivr.net");
    expect(html).not.toMatch(/src=["']https?:\/\//);
  });

  it("uses EventSource for SSE connection", () => {
    expect(html).toContain("EventSource");
  });
});
