// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.ui.form.on("Variation Order", {
	onload(frm) {
		frm.set_query("boq", () => ({ filters: { project: frm.doc.project, docstatus: 1 } }));
	},
	refresh(frm) {
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(
				__("RA Bill"),
				() => frappe.new_doc("RA Bill", { project: frm.doc.project, boq: frm.doc.boq }),
				__("Create")
			);
		}
	},
});

frappe.ui.form.on("Variation Order Item", {
	quantity: (frm, cdt, cdn) => vo_amount(frm, cdt, cdn),
	rate: (frm, cdt, cdn) => vo_amount(frm, cdt, cdn),
	items_remove: (frm) => vo_total(frm),
});

function vo_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	row.amount = flt(row.quantity) * flt(row.rate);
	frm.refresh_field("items");
	vo_total(frm);
}

function vo_total(frm) {
	let total = 0;
	(frm.doc.items || []).forEach((r) => (total += flt(r.amount)));
	frm.set_value("cost_impact", total);
}
