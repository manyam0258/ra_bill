// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.ui.form.on("Measurement Book", {
	onload(frm) {
		frm.set_query("boq", () => ({ filters: { project: frm.doc.project, docstatus: 1 } }));
	},

	refresh(frm) {
		if (frm.doc.boq) {
			frm.add_custom_button(__("Get Work Order Items"), () => populate_from_boq(frm));
		}
		if (frm.doc.docstatus === 1 && !frm.doc.ra_bill) {
			frm.add_custom_button(
				__("RA Bill"),
				() =>
					frappe.new_doc("RA Bill", {
						project: frm.doc.project,
						boq: frm.doc.boq,
						measurement_book: frm.doc.name,
					}),
				__("Create")
			);
		}
	},
});

frappe.ui.form.on("Measurement Entry", {
	nos: (frm, cdt, cdn) => entry_qty(frm, cdt, cdn),
	length: (frm, cdt, cdn) => entry_qty(frm, cdt, cdn),
	breadth: (frm, cdt, cdn) => entry_qty(frm, cdt, cdn),
	depth: (frm, cdt, cdn) => entry_qty(frm, cdt, cdn),
});

function entry_qty(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const nos = flt(row.nos) || 1;
	const length = flt(row.length) || 1;
	const breadth = flt(row.breadth) || 1;
	const depth = flt(row.depth) || 1;
	row.quantity = nos * length * breadth * depth;
	frm.refresh_field("entries");
}

function populate_from_boq(frm) {
	frappe.db.get_doc("RAB Work Order", frm.doc.boq).then((boq) => {
		(boq.items || []).forEach((it) => {
			const child = frm.add_child("entries");
			child.boq_item = it.name;
			child.description = it.description;
			child.uom = it.uom;
		});
		frm.refresh_field("entries");
	});
}
