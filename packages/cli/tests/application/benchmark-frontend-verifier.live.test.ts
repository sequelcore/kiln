import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyFrontendBenchmarkLease } from "../../src/application/benchmark-frontend-verifier.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const CORRECT_COMPONENT = `import { useEffect, useRef, useState } from "react";

export function OrderQueue() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const confirmRef = useRef(null);
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);
  const close = () => { setOpen(false); queueMicrotask(() => triggerRef.current?.focus()); };
  const handleDialogKeyDown = (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      event.preventDefault();
      const actions = event.currentTarget.querySelectorAll("button");
      const next = document.activeElement === actions[0] ? actions[1] : actions[0];
      next?.focus();
    }
  };
  return <main>
    <h1>Order queue</h1>
    <table aria-label="Pending orders">
      <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Action</th></tr></thead>
      <tbody><tr><th scope="row">A-104</th><td>Ada Lovelace</td><td>
        <button ref={triggerRef} aria-label="Review order A-104" onClick={() => setOpen(true)}>Review</button>
      </td></tr></tbody>
    </table>
    {open ? <div className="backdrop" onKeyDown={handleDialogKeyDown}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <h2 id="review-title">Review order A-104</h2>
        <p>Confirm that this order is ready for review.</p>
        <div className="actions">
          <button ref={confirmRef}>Confirm review</button>
          <button className="secondary" onClick={close}>Cancel</button>
        </div>
      </section>
    </div> : null}
  </main>;
}
`;

describe("frontend benchmark Docker verifier", () => {
  it("renders and verifies interaction plus WCAG evidence inside the pinned browser image", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(
      resolveProjectRoot().rootPath,
      "packages/core/evals/fixtures/model-roster-frontend-render-v1",
    );
    try {
      await writeFile(join(lease.rootPath, "src", "OrderQueue.jsx"), CORRECT_COMPONENT, "utf8");
      const result = await verifyFrontendBenchmarkLease({ lease });
      expect(result.process.stderr).toBe("");
      expect(result.process).toMatchObject({ exitCode: 0, timedOut: false });
      expect(result).toMatchObject({
        status: "passed",
        violations: [],
        render: {
          accessibility: { engine: "axe-core", version: "4.12.1", violationCount: 0 },
          assertions: {
            keyboardActivation: true,
            dialogInitialFocus: true,
            dialogFocusTrap: true,
            escapeCloses: true,
            focusRestored: true,
          },
        },
        screenshot: {
          sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          bytes: expect.any(Number),
          base64: expect.any(String),
        },
      });
    } finally {
      lease.cleanup();
    }
  }, 90_000);
});
