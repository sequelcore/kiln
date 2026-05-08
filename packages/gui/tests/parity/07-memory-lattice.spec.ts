import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 7 - memory lattice", () => {
  test("opens the Memory mode and renders the gateway-backed graph", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Memory" }).click();
    await page.getByRole("button", { name: "Open graph" }).click();

    await expect(page.getByRole("tab", { name: "Memory Lattice" })).toHaveAttribute("aria-selected", "true", {
      timeout: 5_000,
    });
    await expect(page.getByRole("region", { name: "Memory graph" })).toBeVisible();
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
  });
});
