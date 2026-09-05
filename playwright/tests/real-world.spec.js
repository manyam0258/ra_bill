// Real-world RA Bill scenarios for Subcontractor (multiple) and Client work orders,
// exercising the renamed RAB Work Order + the carried-forward Additions/Deductions tables.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const AUTH = ".auth/state.json";

// ------------------------------------------------------------------------- //
// SUBCONTRACTOR — a running account on ONE work order carrying a mobilization
// advance (open the Work Order form -> bill 1 -> Purchase Invoice -> bill 2).
// subcon_mob_boq: retention 10%, TDS 2%, labour cess 1%, mobilization recovery 15%,
// items Brickwork 2000@250 + Waterproofing 800@350 (total 780,000); project advance 100,000.
// ------------------------------------------------------------------------- //
test.describe("Subcontractor — running account with mobilization advance", () => {
	test.describe.configure({ mode: "serial" });
	let base;
	let bill1;

	test.beforeAll(async ({ browser }) => {
		base = await H.seedScenario(browser, AUTH);
	});

	test("open the Subcontractor Work Order: renamed doctype, seeded charges, bulk import", async ({ page }) => {
		await page.goto(`/app/rab-work-order/${encodeURIComponent(base.subcon_mob_boq)}`);
		await page.waitForFunction(
			(n) => window.cur_frm && cur_frm.doc && cur_frm.doc.name === n && !cur_frm.doc.__islocal,
			base.subcon_mob_boq,
			{ timeout: 30000 }
		);

		expect(await H.docField(page, "boq_type")).toBe("Subcontractor");
		expect(await H.docField(page, "status")).toBe("Active");
		expect(await H.docField(page, "total_boq_amount")).toBeCloseTo(2000 * 250 + 800 * 350, 0); // 780,000

		// Additions & Deductions are carried as child tables on the Work Order.
		const dtypes = await page.evaluate(() => cur_frm.doc.deductions.map((d) => d.deduction_type));
		expect(dtypes).toEqual(expect.arrayContaining(["Retention", "TDS", "Labour Cess", "Mobilization Recovery"]));
		const atypes = await page.evaluate(() => cur_frm.doc.additions.map((a) => a.addition_type));
		expect(atypes).toEqual(expect.arrayContaining(["Escalation", "Secured Advance"]));

		// The items grid exposes spreadsheet Download / Upload (allow_bulk_edit).
		expect(await page.evaluate(() => !!cur_frm.fields_dict.items.df.allow_bulk_edit)).toBeTruthy();
	});

	test("bill 1: part work + mobilization recovery, certify and raise a Purchase Invoice", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", base.project);
		await H.setLink(page, "boq", base.subcon_mob_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000); // 250,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 400); // 140,000
		await H.save(page);

		expect(await H.docField(page, "bill_type")).toBe("Subcontractor");
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(390000, 0);
		expect(await H.docField(page, "retention_amount")).toBeCloseTo(39000, 0); // 10%
		expect(await H.docField(page, "tds_amount")).toBeCloseTo(7800, 0); // 2%
		// Mobilization recovery 15% of 390,000 = 58,500 (advance balance 100,000 covers it).
		expect(await H.docField(page, "advance_balance_before")).toBeCloseTo(100000, 0);
		expect(await H.docField(page, "mobilization_recovery_amount")).toBeCloseTo(58500, 0);

		await H.approveBill(page);
		bill1 = await H.docField(page, "name");

		await H.clickCustomButton(page, "Create Purchase Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.purchase_invoice, null, { timeout: 30000 });
		expect(await H.docField(page, "purchase_invoice")).toBeTruthy();
	});

	test("bill 2: cumulative to 100%, mobilization recovery capped to remaining balance", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", base.project);
		await H.setLink(page, "boq", base.subcon_mob_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 2000); // full
		await H.setGridCell(page, "items", 1, "cumulative_qty", 800); // full
		await H.save(page);

		// Previous bill auto-linked; previous quantities carried forward.
		expect(await H.docField(page, "previous_ra_bill")).toBe(bill1);
		expect(await H.docField(page, "previous_billed_value")).toBeCloseTo(390000, 0);
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(390000, 0); // this bill only (780k - 390k)

		// Remaining advance balance is 100,000 - 58,500 = 41,500; recovery is capped to it.
		expect(await H.docField(page, "advance_balance_before")).toBeCloseTo(41500, 0);
		expect(await H.docField(page, "mobilization_recovery_amount")).toBeCloseTo(41500, 0);
		expect(await H.docField(page, "retention_amount")).toBeCloseTo(39000, 0); // 10% of 390,000

		await H.approveBill(page);
		expect(await H.docField(page, "docstatus")).toBe(1);
	});
});

// ------------------------------------------------------------------------- //
// SUBCONTRACTOR — independent scenarios, each a fresh first bill.
// ------------------------------------------------------------------------- //
test.describe("Subcontractor — independent scenarios", () => {
	let s;

	test.beforeEach(async ({ browser }) => {
		s = await H.seedScenario(browser, AUTH);
	});

	test("ad-hoc fixed deductions: liquidated damages and water/electricity", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.subcon_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000); // 180,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 500); // 110,000
		// First save: statutory deductions seed from the Work Order.
		await H.save(page);

		// Then the surveyor adds ad-hoc fixed recoveries on top.
		await H.addChildRow(page, "deductions", {
			deduction_type: "Liquidated Damages",
			description: "Delay penalty (milestone 2)",
			method: "Fixed Amount",
			amount: 15000,
		});
		await H.addChildRow(page, "deductions", {
			deduction_type: "Water / Electricity",
			description: "Site utilities",
			method: "Fixed Amount",
			amount: 3000,
		});
		await H.save(page);

		// Statutory (retention 29,000 + TDS 5,800 + cess 2,900) + fixed (15,000 + 3,000) = 55,700
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(290000, 0);
		expect(await H.docField(page, "total_deductions")).toBeCloseTo(55700, 0);
		const types = await page.evaluate(() => cur_frm.doc.deductions.map((d) => d.deduction_type));
		expect(types).toEqual(expect.arrayContaining(["Liquidated Damages", "Water / Electricity"]));

		await H.approveBill(page);
		expect(await H.docField(page, "docstatus")).toBe(1);
	});

	test("secured advance for materials at site, recovered in the next bill", async ({ page }) => {
		// Bill 1 — pay a secured advance for materials at site.
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.subcon_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000);
		await H.setGridCell(page, "items", 1, "cumulative_qty", 500);
		await H.addChildRow(page, "secured_advances", {
			material: "Cement",
			qty_at_site: 200,
			assessed_rate: 400,
			reduced_rate_percent: 90,
		});
		await H.save(page);
		expect(await H.docField(page, "secured_advance_current")).toBeCloseTo(72000, 0);
		expect(await H.docField(page, "secured_advance_adjustment")).toBeCloseTo(72000, 0);
		await H.approveBill(page);
		const first = await H.docField(page, "name");

		// Bill 2 — no materials at site, so the advance is recovered (negative adjustment).
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.subcon_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 1500);
		await H.setGridCell(page, "items", 1, "cumulative_qty", 700);
		await H.save(page);
		expect(await H.docField(page, "previous_ra_bill")).toBe(first);
		expect(await H.docField(page, "secured_advance_previous")).toBeCloseTo(72000, 0);
		expect(await H.docField(page, "secured_advance_adjustment")).toBeCloseTo(-72000, 0);
	});

	test("downward re-measurement produces a recovery (negative) bill", async ({ page }) => {
		// Bill 1 — over-measured at 1000 units.
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.subcon_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 1000); // 180,000
		await H.save(page);
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(180000, 0);
		await H.approveBill(page);

		// Bill 2 — corrected down to 800 units -> this bill is a 200-unit recovery.
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.subcon_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 800);
		await H.save(page);
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(-36000, 0); // (800-1000) x 180
		expect(await H.docField(page, "net_payable")).toBeLessThan(0);
	});
});

// ------------------------------------------------------------------------- //
// CLIENT — GST bill that produces a Sales Invoice.
// ------------------------------------------------------------------------- //
test.describe("Client — GST bill and Sales Invoice", () => {
	let s;

	test.beforeEach(async ({ browser }) => {
		s = await H.seedScenario(browser, AUTH);
	});

	test("client bill applies 18% GST and certifies into a Sales Invoice", async ({ page }) => {
		await H.gotoNew(page, "ra-bill");
		await H.setLink(page, "project", s.project);
		await H.setLink(page, "boq", s.client_boq);
		await H.getItemsFromBOQ(page, 2);
		await H.setGridCell(page, "items", 0, "cumulative_qty", 400); // 120,000
		await H.setGridCell(page, "items", 1, "cumulative_qty", 100); // 600,000
		await H.save(page);

		expect(await H.docField(page, "bill_type")).toBe("Client");
		expect(await H.docField(page, "gross_work_value")).toBeCloseTo(720000, 0);
		// GST 18% on (720,000 + 7,200 cess) = 130,896
		expect(await H.docField(page, "gst_amount")).toBeCloseTo(130896, 0);

		await H.approveBill(page);
		await H.clickCustomButton(page, "Create Sales Invoice");
		await page.waitForFunction(() => window.cur_frm && cur_frm.doc.sales_invoice, null, { timeout: 30000 });
		expect(await H.docField(page, "sales_invoice")).toBeTruthy();
	});
});
