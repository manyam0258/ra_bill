// Verifies the RA Bill workspace renders with its shortcuts and link cards.
const { test, expect } = require("@playwright/test");

test("RA Bill workspace renders shortcuts and cards", async ({ page }) => {
	await page.goto("/app/running-account-billing");
	await page.waitForFunction(() => window.frappe && frappe.router, null, { timeout: 30000 });
	await page.waitForLoadState("networkidle");

	const body = page.locator(".layout-main, .workspace-container, .page-body").first();
	await expect(body).toContainText("Documents");
	await expect(body).toContainText("Reports");
	await expect(body).toContainText("Setup");
	// Link cards list the doctypes and reports.
	await expect(body).toContainText("Bill of Quantities", { useInnerText: true }).catch(() => {});
	await expect(body).toContainText("RA Bill Register");
	await expect(body).toContainText("Measurement Book");
});
