import { describe, it, expect } from "vitest";
import { createDevInspectorHtml } from "../../src/gateway/dev-inspector.js";

describe("createDevInspectorHtml", () => {
    let html: string;

    it("returns a string", () => {
        html = createDevInspectorHtml();
        expect(typeof html).toBe("string");
    });

    it("contains the Kiln Dev Inspector title", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("Kiln Dev Inspector");
    });

    it("contains a Timeline tab", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("Timeline");
    });

    it("contains the timeline container element", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain('id="timeline"');
    });

    it("contains the Events tab", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("Events");
    });

    it("contains the switchTab function", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("switchTab");
    });

    it("contains the toggleSpanDetail function", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("toggleSpanDetail");
    });

    it("contains span color CSS classes for phase and tool kinds", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("tl-phase");
        expect(html).toContain("tl-tool");
        expect(html).toContain("tl-agent");
    });

    it("contains trace_span handling logic in pushEvent", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("trace_span");
        expect(html).toContain("renderTimeline");
    });

    it("contains tl-axis element for the time ruler", () => {
        html ??= createDevInspectorHtml();
        expect(html).toContain("tl-axis");
    });
});
