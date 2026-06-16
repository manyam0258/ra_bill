// Logs in once and persists the session for all specs.
const { test, expect } = require("@playwright/test");
const fs = require("fs");

const USER = process.env.RA_USER || "e2e@ra-bill.test";
const PASSWORD = process.env.RA_PASSWORD || "RaBill@123456";
const AUTH_FILE = ".auth/state.json";

test("authenticate", async ({ page }) => {
	await page.goto("/login");
	await page.locator("#login_email").fill(USER);
	await page.locator("#login_password").fill(PASSWORD);
	await page.locator(".btn-login").click();
	// Wait until the Desk app is loaded.
	await page.waitForURL(/\/app/, { timeout: 30000 });
	await page.waitForFunction(() => window.frappe && frappe.session && frappe.session.user, null, {
		timeout: 30000,
	});
	const user = await page.evaluate(() => frappe.session.user);
	expect(user).toBe(USER);

	if (!fs.existsSync(".auth")) fs.mkdirSync(".auth");
	await page.context().storageState({ path: AUTH_FILE });
});
