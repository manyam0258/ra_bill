# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = frappe._dict(filters or {})
	if not filters.get("boq"):
		frappe.throw(_("Please select a Work Order."))
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Item"), "fieldname": "description", "fieldtype": "Data", "width": 260},
		{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
		{"label": _("Work Order Qty"), "fieldname": "boq_qty", "fieldtype": "Float", "width": 110},
		{"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "width": 100},
		{"label": _("Billed Qty"), "fieldname": "billed_qty", "fieldtype": "Float", "width": 100},
		{"label": _("Balance Qty"), "fieldname": "balance_qty", "fieldtype": "Float", "width": 100},
		{"label": _("% Complete"), "fieldname": "percent", "fieldtype": "Percent", "width": 90},
		{"label": _("Work Order Amount"), "fieldname": "boq_amount", "fieldtype": "Currency", "width": 130},
		{"label": _("Billed Amount"), "fieldname": "billed_amount", "fieldtype": "Currency", "width": 130},
	]


def get_data(filters):
	boq = frappe.get_doc("RAB Work Order", filters.boq)

	# Latest submitted RA Bill carries the cumulative position per line.
	latest = frappe.get_all(
		"RA Bill",
		filters={"boq": boq.name, "docstatus": 1},
		order_by="ra_bill_no desc",
		limit=1,
		pluck="name",
	)
	billed = {}
	if latest:
		for row in frappe.get_doc("RA Bill", latest[0]).items:
			key = row.boq_item or row.description
			billed[key] = (flt(row.cumulative_qty), flt(row.cumulative_amount), flt(row.cumulative_percent))

	data = []
	for item in boq.items:
		bq, bamt, bpct = billed.get(item.name, (0.0, 0.0, 0.0))
		boq_amount = flt(item.boq_qty) * flt(item.rate)
		percent = bpct or (flt(bq) / flt(item.boq_qty) * 100 if flt(item.boq_qty) else 0)
		data.append(
			{
				"description": item.description,
				"uom": item.uom,
				"boq_qty": item.boq_qty,
				"rate": item.rate,
				"billed_qty": bq,
				"balance_qty": flt(item.boq_qty) - flt(bq),
				"percent": percent,
				"boq_amount": boq_amount,
				"billed_amount": bamt,
			}
		)
	return data
