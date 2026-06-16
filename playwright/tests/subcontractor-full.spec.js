// Comprehensive Subcontractor RA Bill scenarios exercising every DocType:
// BOQ, Measurement Book, Variation Order, RA Bill (+ secured advance, escalation,
// deductions), certification workflow, and Purchase Invoice (with TDS).
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const AUTH = ".auth/state.json";

test.describe.configure({ mode: "serial" });

test.describe("Subcontractor RA Bill — full feature set", () => {
	let scenario;

	// Fresh, independent data for every scenario (each is a standalone first bill).
	test.beforeEach(async ({ browser }) => {
		scenario = await H.seedScenario(browser, AUTH);
	});

	test("Scenario 1: MB quantities + secured advance + escalation + recovery deduction → TDS Purchase Invoice", async ({
		page,
	}) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.subcon_boq);
		await H.getItemsFromBOQ(page, 2);

		// Pull this period's measured quantities from the Measurement Book.
		await H.setLink(page, "measurement_book", scenario.subcon_mb);
		await H.getMbQuantities(page);

		// Materials at site (secured advance), price escalation, and a material recovery.
		await H.addChildRow(page, "secured_advances", {
			material: "Cement",
			qty_at_site: 200,
			assessed_rate: 400,
			reduced_rate_percent: 90,
		});
		await H.addChildRow(page, "escalations", {
			description: "Steel",
			quantity: 10,
			base_rate: 50000,
			base_index: 100,
			current_index: 110,
			contractor_share_percent: 85,
		});
		await H.addChildRow(page, "deductions", {
			deduction_type: "Client Material Recovery",
			description: "Cement issued by main contractor",
			method: "Fixed Amount",
			amount: 5000,
		});
		await H.save(page);

		// Work: 1000x180 + 500x220 = 290,000
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(290000, 0);
		// Escalation: (110-100)/100 x 10 x 50,000 x 85% = 42,500
		expect(await H.docField(page, "escalation_amount")).toBeCloseTo(42500, 0);
		expect(await H.docField(page, "billable_value")).toBeCloseTo(332500, 0);
		// Secured advance: 200 x 400 x 90% = 72,000
		expect(await H.docField(page, "secured_advance_current")).toBeCloseTo(72000, 0);
		expect(await H.docField(page, "secured_advance_adjustment")).toBeCloseTo(72000, 0);
		// retention 10% of billable = 33,250 ; tds 2% = 6,650
		expect(await H.docField(page, "retention_amount")).toBeCloseTo(33250, 0);
		// net = total_invoice (396,273.5) - deductions (48,225) + secured adj (72,000)
		expect(await H.docField(page, "net_payable")).toBeCloseTo(420048.5, 0);

		await H.approveBill(page);
		await H.clickCustomButton(page, "Create Purchase Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.purchase_invoice, null, {
			timeout: 30000,
		});
		expect(await H.docField(page, "purchase_invoice")).toBeTruthy();
	});

	test("Scenario 2: subcontract bill incorporating an approved Variation Order", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", scenario.project);
		await H.setLink(page, "boq", scenario.subcon_boq);
		await H.getItemsFromBOQ(page, 2);

		// Pull the approved Variation Order line as an extra item (now 3 rows).
		await H.getVariationItems(page, 3);
		expect(await page.evaluate(() => cur_frm.doc.items[2].variation_order)).toBe(scenario.subcon_vo);

		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000); // 180,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 500); // 110,000
		await H.setGridCell(page, "items", 2, "cumulative_qty", 50); // 50 x 400 = 20,000 (variation)
		await H.save(page);

		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(310000, 0);
		expect(await page.evaluate(() => cur_frm.doc.items[2].is_extra_item)).toBeTruthy();

		await H.approveBill(page);
		await H.clickCustomButton(page, "Create Purchase Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.purchase_invoice, null, {
			timeout: 30000,
		});
		expect(await H.docField(page, "purchase_invoice")).toBeTruthy();
	});
});
