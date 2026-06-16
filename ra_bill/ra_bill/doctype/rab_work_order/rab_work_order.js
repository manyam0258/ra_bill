// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.ui.form.on("RAB Work Order", {
	refresh(frm) {
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(
				__("RA Bill"),
				() => frappe.new_doc("RA Bill", { project: frm.doc.project, boq: frm.doc.name }),
				__("Create")
			);
			frm.add_custom_button(
				__("Variation Order"),
				() => frappe.new_doc("Variation Order", { project: frm.doc.project, boq: frm.doc.name }),
				__("Create")
			);
			frm.add_custom_button(
				__("Measurement Book"),
				() => frappe.new_doc("Measurement Book", { project: frm.doc.project, boq: frm.doc.name }),
				__("Create")
			);
		}
	},

	project(frm) {
		// Keep contract value in step with the Work Order total until the user overrides it.
		if (!frm.doc.contract_value) {
			frm.set_value("contract_value", frm.doc.total_boq_amount);
		}
	},
});

frappe.ui.form.on("RAB Work Order Item", {
	boq_qty: (frm, cdt, cdn) => set_amount(frm, cdt, cdn),
	rate: (frm, cdt, cdn) => set_amount(frm, cdt, cdn),
});

function set_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	row.amount = flt(row.boq_qty) * flt(row.rate);
	frm.refresh_field("items");
	let total = 0;
	(frm.doc.items || []).forEach((r) => (total += flt(r.amount)));
	frm.set_value("total_boq_amount", total);
}
