// Subcontractor-side RA Bill: the main contractor billed by a subcontractor.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const AUTH = ".auth/state.json";

test.describe.configure({ mode: "serial" });

test.describe("Subcontractor RA Bill (subcontractor -> main contractor)", () => {
	let scenario;

	test.beforeAll(async ({ browser }) => {
		scenario = await H.seedScenario(browser, AUTH);
	});

	test("Subcontract RA-1: measure, certify, generate Purchase Invoice (with TDS)", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.subcon_boq);
		await H.getItemsFromBOQ(page, 2);

		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000); // 1000 x 180 = 180,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 500); // 500 x 220 = 110,000
		await H.save(page);

		expect(await H.docField(page, "bill_type")).toBe("Subcontractor");
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(290000, 0);
		// subcontract retention 10% = 29,000
		expect(await H.docField(page, "retention_amount")).toBeCloseTo(29000, 0);

		await H.approveBill(page);

		await H.clickCustomButton(page, "Create Purchase Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.purchase_invoice, null, {
			timeout: 30000,
		});
		const pi = await H.docField(page, "purchase_invoice");
		expect(pi).toBeTruthy();

		// The generated Purchase Invoice should have apply_tds set (native withholding).
		const applyTds = await page.evaluate(async (name) => {
			const d = await frappe.db.get_value("Purchase Invoice", name, "apply_tds");
			return d.message.apply_tds;
		}, pi);
		expect(applyTds).toBe(1);
	});

	test("Subcontract RA-2: recovery bill (downward re-measurement) is allowed", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.subcon_boq);
		await H.getItemsFromBOQ(page, 2);

		// Re-measurement: internal plastering corrected down 1000 -> 900 (recovery),
		// external plastering progresses 500 -> 700.
		await H.setGridCell(page, "items", 0, "cumulative_qty", 900);
		await H.setGridCell(page, "items", 1, "cumulative_qty", 700);
		await H.save(page);

		// this bill = (900-1000)x180 + (700-500)x220 = -18,000 + 44,000 = 26,000
		expect(await page.evaluate(() => cur_frm.doc.items[0].current_qty)).toBeCloseTo(-100, 0);
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(26000, 0);
	});
});
