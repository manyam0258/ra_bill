// Reusable helpers for driving Frappe Desk forms with Playwright.
const { expect } = require("@playwright/test");

async function seedScenario(browser, authFile) {
	const ctx = await browser.newContext({ storageState: authFile });
	const page = await ctx.newPage();
	await page.goto("/app/ra-bill");
	await page.waitForFunction(() => window.frappe && frappe.call, null, { timeout: 30000 });
	const data = await page.evaluate(async () => {
		const r = await frappe.call({ method: "ra_bill.demo.seed_e2e" });
		return r.message;
	});
	await ctx.close();
	return data;
}

async function gotoNew(page, slug) {
	await page.goto(`/app/${slug}/new`);
	await page.waitForFunction(() => window.cur_frm && cur_frm.doc, null, { timeout: 30000 });
}

async function setLink(page, fieldname, value) {
	// set_value runs the same validations, fetch_from and change handlers
	// (e.g. our boq -> "Get Items") that a UI selection triggers, without the
	// flakiness of driving the autocomplete dropdown.
	await page.evaluate(
		async ([f, v]) => {
			await window.cur_frm.set_value(f, v);
		},
		[fieldname, String(value)]
	);
	await page.waitForFunction(
		([f, v]) => window.cur_frm && cur_frm.doc[f] === v,
		[fieldname, String(value)],
		{ timeout: 15000 }
	);
}

// Grid-cell entry through the app's model API — runs the real RA Bill Item
// client handler (recalc_row), the same code path a user keystroke triggers,
// without the flakiness of headless grid-cell editing.
async function setGridCell(page, table, rowIdx, field, value) {
	await page.evaluate(
		([t, i, f, v]) => {
			const row = window.cur_frm.doc[t][i];
			return frappe.model.set_value(row.doctype, row.name, f, v);
		},
		[table, rowIdx, field, value]
	);
}

// Invokes the real "Get Items from BOQ" form handler.
async function getItemsFromBOQ(page, count) {
	await page.evaluate(() => window.cur_frm.events.get_items_btn(window.cur_frm));
	await waitItemsLoaded(page, count);
}

// Invokes the real "Get Variation Items" handler; waits until item count reaches `count`.
async function getVariationItems(page, count) {
	await page.evaluate(() => window.cur_frm.events.get_variation_btn(window.cur_frm));
	await waitItemsLoaded(page, count);
}

// Invokes the real "Get Quantities from Measurement Book" handler.
async function getMbQuantities(page) {
	await page.evaluate(() => window.cur_frm.events.get_mb_btn(window.cur_frm));
	await page.waitForTimeout(500);
}

// Adds a child-table row with values; the server controller recomputes on save.
async function addChildRow(page, table, values) {
	await page.evaluate(
		([t, vals]) => {
			window.cur_frm.add_child(t, vals);
			window.cur_frm.refresh_field(t);
			window.cur_frm.dirty();
		},
		[table, values]
	);
}

async function waitItemsLoaded(page, count) {
	await page.waitForFunction(
		(n) => window.cur_frm && cur_frm.doc.items && cur_frm.doc.items.length >= n,
		count,
		{ timeout: 30000 }
	);
}

// Saving a brand-new doc switches the route (new -> named), which can destroy the
// evaluate context mid-call; tolerate that and then poll for the saved state.
async function save(page) {
	try {
		await page.evaluate(() => window.cur_frm.save());
	} catch (e) {
		if (!/context was destroyed|navigation/i.test(String(e))) throw e;
	}
	await page.waitForFunction(() => window.cur_frm && !cur_frm.doc.__unsaved && !cur_frm.doc.__islocal, null, {
		timeout: 30000,
	});
}

// Submits a (non-workflow) submittable doc such as a Work Order through the form,
// auto-accepting the "Permanently Submit" confirmation.
async function submitForm(page) {
	try {
		await page.evaluate(() => {
			frappe.confirm = (_msg, onYes) => onYes && onYes();
			return window.cur_frm.savesubmit();
		});
	} catch (e) {
		if (!/context was destroyed|navigation/i.test(String(e))) throw e;
	}
	await page.waitForFunction(() => window.cur_frm && cur_frm.doc.docstatus === 1, null, { timeout: 30000 });
}

async function workflowAction(page, action) {
	// Workflow transitions live under the "Actions" dropdown in the page toolbar.
	const actions = page.locator(".page-actions").getByRole("button", { name: "Actions" }).first();
	await actions.click();
	const item = page
		.locator(".dropdown-menu.show, .dropdown-menu")
		.locator("a, button", { hasText: action })
		.first();
	await item.waitFor({ state: "visible", timeout: 10000 });
	await item.click();
}

async function advanceWorkflow(page, action, expectedState) {
	await workflowAction(page, action);
	await page.waitForFunction(
		(s) => window.cur_frm && cur_frm.doc.workflow_state === s,
		expectedState,
		{ timeout: 30000 }
	);
}

// Walk Draft -> Measured -> Checked -> Certified -> Approved (docstatus 1).
async function approveBill(page) {
	await advanceWorkflow(page, "Submit for Measurement", "Measured");
	await advanceWorkflow(page, "Check", "Checked");
	await advanceWorkflow(page, "Certify", "Certified");
	await advanceWorkflow(page, "Approve", "Approved");
	await page.waitForFunction(() => window.cur_frm && cur_frm.doc.docstatus === 1, null, {
		timeout: 30000,
	});
}

async function clickCustomButton(page, name) {
	const btn = page.locator(".page-actions").getByRole("button", { name }).first();
	await btn.click();
}

async function docField(page, fieldname) {
	return page.evaluate((f) => window.cur_frm.doc[f], fieldname);
}

module.exports = {
	seedScenario,
	gotoNew,
	setLink,
	setGridCell,
	getItemsFromBOQ,
	getVariationItems,
	getMbQuantities,
	addChildRow,
	waitItemsLoaded,
	save,
	submitForm,
	workflowAction,
	advanceWorkflow,
	approveBill,
	clickCustomButton,
	docField,
};
