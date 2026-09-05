frappe.ui.form.on("Purchase Invoice", {
	setup(frm) {
		frm.set_df_property("ra_bill_deductions", "read_only", 1);
	},

	refresh(frm) {
		frm.set_df_property("ra_bill_deductions", "read_only", 1);
		if (frm.fields_dict.ra_bill_deductions && frm.fields_dict.ra_bill_deductions.grid) {
			frm.fields_dict.ra_bill_deductions.grid.cannot_add_rows = true;
			frm.fields_dict.ra_bill_deductions.grid.cannot_delete_rows = true;
			frm.fields_dict.ra_bill_deductions.grid.only_sortable();
			frm.fields_dict.ra_bill_deductions.grid.refresh();
		}
	},
});
