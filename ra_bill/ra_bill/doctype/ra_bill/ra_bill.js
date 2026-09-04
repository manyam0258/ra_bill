// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.ui.form.on("RA Bill", {
	onload(frm) {
		frm.set_query("boq", () => ({
			filters: { project: frm.doc.project, docstatus: 1 },
		}));
		frm.set_query("measurement_book", () => ({
			filters: { boq: frm.doc.boq, docstatus: 1 },
		}));
		frm.set_query("previous_ra_bill", () => ({
			filters: { boq: frm.doc.boq, docstatus: 1, name: ["!=", frm.doc.name || ""] },
		}));
		frm.set_query("cost_center", () => ({
			filters: { company: frm.doc.company, is_group: 0 },
		}));
	},

	refresh(frm) {
		if (frm.doc.docstatus === 1 && !frm.doc.sales_invoice && !frm.doc.purchase_invoice) {
			const label =
				frm.doc.bill_type === "Client" ? __("Create Sales Invoice") : __("Create Purchase Invoice");
			frm.add_custom_button(label, () => {
				frappe.call({
					method: "ra_bill.ra_bill.doctype.ra_bill.ra_bill.make_invoice",
					args: { ra_bill: frm.doc.name },
					freeze: true,
					freeze_message: __("Creating invoice..."),
					callback: (r) => {
						if (r.message) {
							frappe.show_alert({ message: __("Invoice {0} created", [r.message]), indicator: "green" });
							frm.reload_doc();
						}
					},
				});
			}).addClass("btn-primary");
		}

		if (frm.doc.sales_invoice) {
			frm.add_custom_button(__("Sales Invoice"), () =>
				frappe.set_route("Form", "Sales Invoice", frm.doc.sales_invoice),
				__("View")
			);
		}

		if (frm.doc.purchase_invoice) {
			frm.add_custom_button(__("Purchase Invoice"), () =>
				frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice),
				__("View")
			);
		}

		if (!frm.is_new() && frm.doc.boq) {
			frm.add_custom_button(__("Get Advances"), function () {

				frappe.call({
					method: "ra_bill.ra_bill.doctype.ra_bill.ra_bill.get_advances",
					args: {
						boq: frm.doc.boq
					},
					callback: function (r) {

						if (!r.message || !r.message.length) {
							frappe.msgprint(
								__("No pending advance recoveries found for this Work Order.")
							);
							return;
						}

						frm.doc.deductions = (frm.doc.deductions || []).filter(
							row => row.deduction_type !== "Advance Recovery"
						);

						r.message.forEach(function (d) {

							let row = frm.add_child("deductions");

							row.deduction_type = "Advance Recovery";
							row.description = "Advance Recovery";
							row.method = "Fixed Amount";
							row.amount = d.balance_amount;
							row.payment_entry = d.payment_entry;

						});

						frm.refresh_field("deductions");
						frm_recalc(frm);

					}
				});

			});
		}
	},
	get_items_btn(frm) {
		if (!frm.doc.boq) {
			frappe.msgprint(__("Select a Work Order first."));
			return;
		}

		const fetch_items = () => {
			frappe.call({
				method: "ra_bill.ra_bill.doctype.ra_bill.ra_bill.get_boq_items",
				args: { boq: frm.doc.boq, previous_ra_bill: frm.doc.previous_ra_bill },
				callback: (r) => {
					if (!r.message) return;
					frm.clear_table("items");
					r.message.forEach((row) => {
						const child = frm.add_child("items");
						Object.assign(child, row);
					});
					frm.refresh_field("items");
					frm_recalc(frm);
				},
			});
		};

		if (!frm.doc.previous_ra_bill) {
			frappe.db.get_value(
				"RA Bill",
				{ boq: frm.doc.boq, docstatus: 1, name: ["!=", frm.doc.name || ""] },
				"name",
				(r) => {
					if (r && r.name) {
						frm.set_value("previous_ra_bill", r.name);
					}
					fetch_items();
				},
				{ order_by: "ra_bill_no desc, creation desc" }
			);
		} else {
			fetch_items();
		}
	},
	get_variation_btn(frm) {
		if (!frm.doc.boq) {
			frappe.msgprint(__("Select a Work Order first."));
			return;
		}
		frappe.call({
			method: "ra_bill.ra_bill.doctype.variation_order.variation_order.get_variation_items",
			args: { boq: frm.doc.boq },
			callback: (r) => {
				if (!r.message || !r.message.length) {
					frappe.msgprint(__("No approved Variation Order items found for this Work Order."));
					return;
				}
				r.message.forEach((row) => {
					const child = frm.add_child("items");
					Object.assign(child, row);
				});
				frm.refresh_field("items");
				frm_recalc(frm);
			},
		});
	},
	get_mb_btn(frm) {
		if (!frm.doc.measurement_book) {
			frappe.msgprint(__("Select a Measurement Book first."));
			return;
		}
		frappe.call({
			method: "ra_bill.ra_bill.doctype.ra_bill.ra_bill.get_mb_quantities",
			args: { measurement_book: frm.doc.measurement_book },
			callback: (r) => {
				const totals = r.message || {};
				(frm.doc.items || []).forEach((row) => {
					const key = row.boq_item || row.description;
					if (totals[key] !== undefined) {
						row.cumulative_qty = flt(row.previous_qty) + flt(totals[key]);
						recalc_row_values(frm, row);
					}
				});
				frm.refresh_field("items");
				frm_recalc(frm);
				frappe.show_alert({ message: __("Quantities pulled from Measurement Book"), indicator: "green" });
			},
		});
	},

	boq(frm) {
		if (frm.doc.boq && (!frm.doc.items || !frm.doc.items.length)) {
			frm.events.get_items_btn(frm);
		}
	},

	gst_percentage: (frm) => frm_recalc(frm),
	apply_gst: (frm) => frm_recalc(frm),
});

frappe.ui.form.on("RA Bill Addition", {
	addition_type: (frm) => frm_recalc(frm),
	method: (frm) => frm_recalc(frm),
	rate: (frm) => frm_recalc(frm),
	amount: (frm) => frm_recalc(frm),
	additions_remove: (frm) => frm_recalc(frm),
});

frappe.ui.form.on("RA Bill Deduction", {
	deduction_type: (frm) => frm_recalc(frm),
	method: (frm) => frm_recalc(frm),
	rate: (frm) => frm_recalc(frm),
	amount: (frm) => frm_recalc(frm),
	cap_percentage: (frm) => frm_recalc(frm),
	deductions_remove: (frm) => frm_recalc(frm),
});

frappe.ui.form.on("RA Bill Escalation", {
	quantity: (frm) => frm_recalc(frm),
	base_rate: (frm) => frm_recalc(frm),
	base_index: (frm) => frm_recalc(frm),
	current_index: (frm) => frm_recalc(frm),
	contractor_share_percent: (frm) => frm_recalc(frm),
	escalations_remove: (frm) => frm_recalc(frm),
});

frappe.ui.form.on("RA Bill Secured Advance", {
	qty_at_site: (frm) => frm_recalc(frm),
	assessed_rate: (frm) => frm_recalc(frm),
	reduced_rate_percent: (frm) => frm_recalc(frm),
	secured_advances_remove: (frm) => frm_recalc(frm),
});

frappe.ui.form.on("RA Bill Item", {
	cumulative_qty: (frm, cdt, cdn) => recalc_row(frm, cdt, cdn),
	cumulative_percent: (frm, cdt, cdn) => recalc_row(frm, cdt, cdn),
	rate: (frm, cdt, cdn) => recalc_row(frm, cdt, cdn),
	items_remove: (frm) => frm_recalc(frm),
});

function recalc_row(frm, cdt, cdn) {
	recalc_row_values(frm, locals[cdt][cdn]);
	frm.refresh_field("items");
	frm_recalc(frm);
}

function recalc_row_values(frm, row) {
	row.contract_amount = flt(row.boq_qty) * flt(row.rate);
	const measured = (frm.doc.billing_method || "Item Rate (Measured)") === "Item Rate (Measured)";
	if (measured) {
		row.current_qty = flt(row.cumulative_qty) - flt(row.previous_qty);
		row.current_amount = flt(row.current_qty) * flt(row.rate);
		row.previous_amount = flt(row.previous_qty) * flt(row.rate);
		row.cumulative_amount = flt(row.cumulative_qty) * flt(row.rate);
		row.deviation_qty = flt(row.cumulative_qty) - flt(row.boq_qty);
	} else {
		row.current_percent = flt(row.cumulative_percent) - flt(row.previous_percent);
		row.previous_amount = (row.contract_amount * flt(row.previous_percent)) / 100;
		row.cumulative_amount = (row.contract_amount * flt(row.cumulative_percent)) / 100;
		row.current_amount = (row.contract_amount * flt(row.current_percent)) / 100;
	}
}

// Lightweight client-side preview; the server controller is authoritative on save.
// Note: retention cumulative cap is applied only on the server, so the previewed
// retention may differ once the cap is reached.
function frm_recalc(frm) {
	let gross = 0,
		prev = 0;
	(frm.doc.items || []).forEach((r) => {
		gross += flt(r.current_amount);
		prev += flt(r.previous_amount);
	});
	let escalation = 0;
	(frm.doc.escalations || []).forEach((e) => {
		const base = flt(e.base_index);
		const factor = base ? (flt(e.current_index) - base) / base : 0;
		e.escalation_amount = (factor * flt(e.quantity) * flt(e.base_rate) * flt(e.contractor_share_percent)) / 100;
		escalation += e.escalation_amount;
	});
	let securedCurrent = 0;
	(frm.doc.secured_advances || []).forEach((s) => {
		s.advance_amount = (flt(s.qty_at_site) * flt(s.assessed_rate) * flt(s.reduced_rate_percent)) / 100;
		securedCurrent += s.advance_amount;
	});
	const securedAdj = securedCurrent - flt(frm.doc.secured_advance_previous);

	// Additions: Escalation / Secured Advance mirror the detail tables; the rest add value.
	const work_base = gross + escalation;
	let additions_total = 0;
	(frm.doc.additions || []).forEach((a) => {
		if (a.addition_type === "Escalation") {
			a.amount = escalation;
		} else if (a.addition_type === "Secured Advance") {
			a.amount = securedAdj;
		} else if (a.method === "Fixed Amount") {
			additions_total += flt(a.amount);
		} else {
			a.amount = (work_base * flt(a.rate)) / 100;
			additions_total += flt(a.amount);
		}
	});
	const billable = work_base + additions_total;
	const advBal = flt(frm.doc.advance_balance_before);

	// Deductions carried forward from the Work Order.
	let retention = 0,
		tds = 0,
		mob = 0,
		totalDed = 0;

	const descMap = {
		"Retention": "Retention on Gross Work Value",
		"TDS": "TDS on Gross Work Value",
		"Labour Cess": "Labour Cess on Gross Work Value",
		"Mobilization Recovery": "Mobilization Recovery on Advance Amount"
	};

	(frm.doc.deductions || []).forEach((d) => {
		if (descMap[d.deduction_type]) {
			d.description = descMap[d.deduction_type];
		}
		let amt;
		if (d.method === "Fixed Amount") {
			amt = flt(d.amount);
		} else if (d.deduction_type === "Mobilization Recovery") {
			amt = Math.min((billable * flt(d.rate)) / 100, advBal);
		} else {
			amt = (billable * flt(d.rate)) / 100;
		}
		d.amount = amt;
		totalDed += amt;
		if (d.deduction_type === "Retention") retention += amt;
		else if (d.deduction_type === "TDS") tds += amt;
		else if (d.deduction_type === "Mobilization Recovery") mob += amt;
	});

	const gst = frm.doc.apply_gst ? (billable * flt(frm.doc.gst_percentage)) / 100 : 0;
	const totalInvoice = billable + gst;

	frm.set_value("gross_work_value", gross);
	frm.set_value("previous_billed_value", prev);
	frm.set_value("cumulative_work_value", gross + prev);
	frm.set_value("escalation_amount", escalation);
	frm.set_value("additions_total", additions_total);
	frm.set_value("billable_value", billable);
	frm.set_value("gst_amount", gst);
	frm.set_value("total_invoice_value", totalInvoice);
	frm.set_value("retention_amount", retention);
	frm.set_value("tds_amount", tds);
	frm.set_value("mobilization_recovery_amount", mob);
	frm.set_value("secured_advance_current", securedCurrent);
	frm.set_value("secured_advance_adjustment", securedAdj);
	frm.set_value("total_deductions", totalDed);
	frm.set_value("net_payable", totalInvoice - totalDed + securedAdj);
	frm.refresh_field("escalations");
	frm.refresh_field("secured_advances");
	frm.refresh_field("additions");
	frm.refresh_field("deductions");
}
