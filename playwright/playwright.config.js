// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const BASE_URL = process.env.RA_BASE_URL || "http://localhost:8001";

module.exports = defineConfig({
	testDir: "./tests",
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: BASE_URL,
		headless: true,
		viewport: { width: 1440, height: 900 },
		actionTimeout: 20_000,
		navigationTimeout: 30_000,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "setup", testMatch: /auth\.setup\.js/ },
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], storageState: ".auth/state.json" },
			dependencies: ["setup"],
		},
	],
});
