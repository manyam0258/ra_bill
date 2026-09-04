// Client-side RA Bill scenarios: a contractor billing the client/developer.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const AUTH = ".auth/state.json";

test.describe.configure({ mode: "serial" });

test.describe("Client RA Bill (contractor -> client)", () => {
	let scenario;

	test.beforeAll(async ({ browser }) => {
		scenario = await H.seedScenario(browser, AUTH);
	});

	test("RA-1: measure, certify through workflow, generate GST Sales Invoice", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.client_boq);
		await H.getItemsFromBOQ(page, 2);

		// Measured quantities this period (cumulative).
		await H.setGridCell(page, "items", 0, "cumulative_qty", 400); // 400 x 300 = 120,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 100); // 100 x 6,000 = 600,000
		await H.save(page);

		expect(await H.docField(page, "bill_type")).toBe("Client");
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(720000, 0);
		// labour cess 1% = 7,200 ; GST 18% of (720000 + 7200) = 130,896
		expect(await H.docField(page, "gst_amount")).toBeCloseTo(130896, 0);

		// Certification workflow: Draft -> Measured -> Checked -> Certified -> Approved.
		await H.approveBill(page);

		// Generate the GST Sales Invoice from the certified bill.
		await H.clickCustomButton(page, "Create Sales Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.sales_invoice, null, {
			timeout: 30000,
		});
		const si = await H.docField(page, "sales_invoice");
		expect(si).toBeTruthy();
		scenario.ra1 = await H.docField(page, "name");
	});

	test("RA-2: cumulative running account pulls previous quantities", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.client_boq);
		await H.getItemsFromBOQ(page, 2);

		await H.setGridCell(page, "items", 0, "cumulative_qty", 700); // prev 400 -> this 300
		await H.setGridCell(page, "items", 1, "cumulative_qty", 250); // prev 100 -> this 150
		await H.save(page);

		// Server links the previous RA Bill and back-fills previous quantities.
		expect(await page.evaluate(() => cur_frm.doc.items[0].previous_qty)).toBeCloseTo(400, 0);
		expect(await page.evaluate(() => cur_frm.doc.items[0].current_qty)).toBeCloseTo(300, 0);
		// this bill = 300x300 + 150x6000 = 90,000 + 900,000 = 990,000
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(990000, 0);
		expect(await H.docField(page, "previous_billed_value")).toBeCloseTo(720000, 0);
		expect(await H.docField(page, "previous_ra_bill")).toBe(scenario.ra1);

		await H.approveBill(page);
		expect(await H.docField(page, "docstatus")).toBe(1);
	});
});
