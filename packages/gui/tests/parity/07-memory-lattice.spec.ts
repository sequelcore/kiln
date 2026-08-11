import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 7 - memory lattice", () => {
  test("opens the Memory mode and renders the gateway-backed graph", async ({ page }) => {
    const unsupportedRendererColors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("THREE.Color: Unknown color model")) {
        unsupportedRendererColors.push(message.text());
      }
    });

    await page.goto("/");
    await waitForGuiReady(page);

    await page.getByRole("button", { name: "Memory" }).click();

    await expect(page.getByRole("region", { name: "Memory graph" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Memory Lattice records" })).toContainText(
      "Memory Lattice contract",
    );
    await expect(page.getByRole("region", { name: "Memory records" })).toContainText("Context admission evidence");

    await page
      .getByRole("region", { name: "Memory Lattice records" })
      .getByRole("button", { name: "Context admission evidence", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Memory Lattice surface" }).getByRole("region", { name: "Memory record detail" }),
    ).toContainText("context-admission-evidence");
    expect(unsupportedRendererColors).toEqual([]);
  });
});
