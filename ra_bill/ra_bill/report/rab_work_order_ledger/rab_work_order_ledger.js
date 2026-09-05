// Copyright (c) 2026, Surendhra and contributors
// For license information, please see license.txt

frappe.query_reports["RAB Work Order Ledger"] = {
	filters: [
		{
			fieldname: "rab_work_order",
			label: __("RAB Work Order"),
			fieldtype: "Link",
			options: "RAB Work Order",
			reqd: 1,
			default: frappe.route_options ? frappe.route_options.rab_work_order : "",
		},
	],
	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (data && data.is_header) {
			if (column.fieldname === "account") {
				return `<div style="font-size: 13px; font-weight: 700; color: #1a202c; background-color: #edf2f7; padding: 4px 8px; border-radius: 3px;">${data.account}</div>`;
			}
			return "";
		}
		return value;
	},
};
