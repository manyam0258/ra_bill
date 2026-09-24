frappe.ui.form.on("Payment Entry", {
	setup(frm) {
		frm.set_query("reference_doctype", "references", function () {
			let doctypes = ["Journal Entry"];
			if (frm.doc.party_type === "Customer") {
				doctypes = ["Sales Order", "Sales Invoice", "Journal Entry", "Dunning"];
			} else if (frm.doc.party_type === "Supplier") {
				doctypes = ["Purchase Order", "Purchase Invoice", "Journal Entry"];
			}

			return {
				filters: { name: ["in", doctypes] },
			};
		});
	},
});
