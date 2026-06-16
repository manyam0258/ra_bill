# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("RA Bill"), "fieldname": "name", "fieldtype": "Link", "options": "RA Bill", "width": 130},
		{"label": _("No."), "fieldname": "ra_bill_no", "fieldtype": "Int", "width": 60},
		{"label": _("Project"), "fieldname": "project", "fieldtype": "Link", "options": "Project", "width": 150},
		{"label": _("Type"), "fieldname": "bill_type", "fieldtype": "Data", "width": 100},
		{"label": _("Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 95},
		{"label": _("Gross Work"), "fieldname": "gross_work_value", "fieldtype": "Currency", "width": 120},
		{"label": _("Cess+GST"), "fieldname": "taxes", "fieldtype": "Currency", "width": 110},
		{"label": _("Deductions"), "fieldname": "total_deductions", "fieldtype": "Currency", "width": 120},
		{"label": _("Net Payable"), "fieldname": "net_payable", "fieldtype": "Currency", "width": 130},
		{"label": _("Status"), "fieldname": "status_label", "fieldtype": "Data", "width": 90},
		{"label": _("Invoice"), "fieldname": "invoice", "fieldtype": "Dynamic Link", "options": "invoice_doctype", "width": 130},
	]


def get_data(filters):
	conditions = {"docstatus": ["<", 2]}
	if filters.get("project"):
		conditions["project"] = filters.project
	if filters.get("bill_type"):
		conditions["bill_type"] = filters.bill_type
	if filters.get("from_date") and filters.get("to_date"):
		conditions["posting_date"] = ["between", [filters.from_date, filters.to_date]]

	rows = frappe.get_all(
		"RA Bill",
		filters=conditions,
		fields=[
			"name", "ra_bill_no", "project", "bill_type", "posting_date",
			"gross_work_value", "labour_cess_amount", "gst_amount", "total_deductions",
			"net_payable", "docstatus", "sales_invoice", "purchase_invoice",
		],
		order_by="project asc, ra_bill_no asc",
	)
	out = []
	for r in rows:
		r["taxes"] = (r.labour_cess_amount or 0) + (r.gst_amount or 0)
		r["status_label"] = {0: "Draft", 1: "Submitted"}.get(r.docstatus, "Cancelled")
		if r.sales_invoice:
			r["invoice"], r["invoice_doctype"] = r.sales_invoice, "Sales Invoice"
		elif r.purchase_invoice:
			r["invoice"], r["invoice_doctype"] = r.purchase_invoice, "Purchase Invoice"
		else:
			r["invoice"], r["invoice_doctype"] = None, None
		out.append(r)
	return out
