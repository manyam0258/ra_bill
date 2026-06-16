// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.query_reports["RA Bill Register"] = {
	filters: [
		{ fieldname: "project", label: __("Project"), fieldtype: "Link", options: "Project" },
		{
			fieldname: "bill_type",
			label: __("Bill Type"),
			fieldtype: "Select",
			options: ["", "Client", "Subcontractor"],
		},
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
	],
};
