// Generic billing methods: a Percentage Completion / Milestone client bill.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const AUTH = ".auth/state.json";

test.describe.configure({ mode: "serial" });

test.describe("Percentage / Milestone billing", () => {
	let scenario;

	test.beforeAll(async ({ browser }) => {
		scenario = await H.seedScenario(browser, AUTH);
	});

	test("Percentage Completion bill computes from % of line value", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.pct_boq);
		await H.getItemsFromBOQ(page, 2);

		expect(await H.docField(page, "billing_method")).toBe("Percentage Completion");

		// 30% of a 1,000,000 milestone; finishing untouched.
		await H.setGridCell(page, "items", 0, "cumulative_percent", 30);
		await H.save(page);
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(300000, 0);

		await H.approveBill(page);
		expect(await H.docField(page, "docstatus")).toBe(1);
	});

	test("Next bill advances milestones cumulatively", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.pct_boq);
		await H.getItemsFromBOQ(page, 2);

		// Superstructure 30% -> 60%, Finishing 0% -> 20%.
		await H.setGridCell(page, "items", 0, "cumulative_percent", 60);
		await H.setGridCell(page, "items", 1, "cumulative_percent", 20);
		await H.save(page);

		expect(await page.evaluate(() => cur_frm.doc.items[0].previous_percent)).toBeCloseTo(30, 0);
		// (60-30)% x 1,000,000 + (20-0)% x 500,000 = 300,000 + 100,000
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(400000, 0);
	});
});
