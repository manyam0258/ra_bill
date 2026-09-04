// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.ui.form.on("RAB Work Order", {
	refresh(frm) {
		if (frm.doc.docstatus === 1) {

			frm.add_custom_button(
				__("RA Bill"),
				() => frappe.new_doc("RA Bill", {
					project: frm.doc.project,
					boq: frm.doc.name
				}),
				__("Create")
			);

			frm.add_custom_button(
				__("Variation Order"),
				() => frappe.new_doc("Variation Order", {
					project: frm.doc.project,
					boq: frm.doc.name
				}),
				__("Create")
			);

			frm.add_custom_button(
				__("Measurement Book"),
				() => frappe.new_doc("Measurement Book", {
					project: frm.doc.project,
					boq: frm.doc.name
				}),
				__("Create")
			);

			frm.add_custom_button(
				__("Payment"),
				() => frm.events.make_payment_entry(frm),
				__("Create")
			);

			frm.add_custom_button(
				__("Mobilization Advance"),
				() => frm.events.make_mobilization_payment_entry(frm),
				__("Create")
			);

			frm.add_custom_button(
				__("Ad Hoc Payment"),
				() => frm.events.make_adhoc_payment_entry(frm),
				__("Create")
			);

			frm.add_custom_button(
				__("Ledger"),
				() => {
					frappe.set_route("query-report", "RAB Work Order Ledger", {
						rab_work_order: frm.doc.name,
					});
				},
				__("View")
			);
		}
	},

	make_payment_entry(frm) {
		frappe.call({
			method: "ra_bill.ra_bill.doctype.rab_work_order.rab_work_order.make_payment_entry",
			args: {
				work_order: frm.doc.name
			},
			callback(r) {
				if (r.message) {
					frappe.model.sync(r.message);
					frappe.set_route("Form", r.message.doctype, r.message.name);
				}
			}
		});
	},

	make_mobilization_payment_entry(frm) {
		frappe.prompt(
			[
				{
					fieldname: "advance_amount",
					fieldtype: "Currency",
					label: __("Mobilization Advance Amount"),
					default: flt(frm.doc.mobilization_advance_amount) || "",
					reqd: 1,
					description: __("Enter the Mobilization Advance amount to pay to the contractor.")
				}
			],
			(values) => {
				frappe.call({
					method: "ra_bill.ra_bill.doctype.rab_work_order.rab_work_order.create_mobilization_payment_entry",
					args: {
						work_order: frm.doc.name,
						advance_amount: values.advance_amount
					},
					callback(r) {
						if (r.message) {
							const doc = (typeof r.message === "object") ? frappe.model.sync(r.message)[0] : null;
							const doc_name = (typeof r.message === "string") ? r.message : (r.message.name || (doc && doc.name));
							const doctype = (typeof r.message === "object" && r.message.doctype) ? r.message.doctype : "Payment Entry";
							frappe.set_route("Form", doctype, doc_name);
						}
					}
				});
			},
			__("Create Mobilization Advance"),
			__("Create")
		);
	},

	make_adhoc_payment_entry(frm) {
		frappe.prompt(
			[
				{
					fieldname: "advance_amount",
					fieldtype: "Currency",
					label: __("Ad Hoc Advance Amount"),
					reqd: 1,
					description: __("Enter the Ad Hoc Advance amount to pay to the contractor.")
				}
			],
			(values) => {
				frappe.call({
					method: "ra_bill.ra_bill.doctype.rab_work_order.rab_work_order.create_adhoc_payment_entry",
					args: {
						work_order: frm.doc.name,
						advance_amount: values.advance_amount
					},
					callback(r) {
						if (r.message) {
							const doc = (typeof r.message === "object") ? frappe.model.sync(r.message)[0] : null;
							const doc_name = (typeof r.message === "string") ? r.message : (r.message.name || (doc && doc.name));
							const doctype = (typeof r.message === "object" && r.message.doctype) ? r.message.doctype : "Payment Entry";
							frappe.set_route("Form", doctype, doc_name);
						}
					}
				});
			},
			__("Ad Hoc Advance Payment"),
			__("Create Payment")
		);
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
