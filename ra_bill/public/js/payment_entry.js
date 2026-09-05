frappe.ui.form.on("Payment Entry", {
	setup(frm) {
		// Allow "RAB Work Order" as a valid reference_doctype in grid filter for Supplier payments
		frm.set_query("reference_doctype", "references", function () {
			let doctypes = ["Journal Entry"];
			if (frm.doc.party_type === "Customer") {
				doctypes = ["Sales Order", "Sales Invoice", "Journal Entry", "Dunning"];
			} else if (frm.doc.party_type === "Supplier") {
				doctypes = ["Purchase Order", "Purchase Invoice", "Journal Entry", "RAB Work Order"];
			}

			return {
				filters: { name: ["in", doctypes] },
			};
		});

		// Preserve server-attached RAB Work Order references if ERPNext's party event handler calls clear_table("references")
		const original_clear_table = frm.clear_table.bind(frm);
		frm.clear_table = function (fieldname) {
			if (fieldname === "references") {
				const rab_refs = (this.doc.references || [])
					.filter((r) => r.reference_doctype === "RAB Work Order")
					.map((r) => Object.assign({}, r));

				original_clear_table(fieldname);

				if (rab_refs.length) {
					rab_refs.forEach((r) => {
						let child = this.add_child("references");
						Object.assign(child, r);
					});
				}
			} else {
				original_clear_table(fieldname);
			}
		};
	},
});
