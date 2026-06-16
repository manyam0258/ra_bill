// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.query_reports["RA Bill Abstract"] = {
	filters: [
		{
			fieldname: "boq",
			label: __("Work Order"),
			fieldtype: "Link",
			options: "RAB Work Order",
			reqd: 1,
		},
	],
};
