# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class VariationOrder(Document):
	def validate(self):
		total = 0.0
		for row in self.items:
			row.amount = flt(row.quantity) * flt(row.rate)
			total += row.amount
		self.cost_impact = total

	def on_submit(self):
		self.db_set("status", "Approved")

	def on_cancel(self):
		self.db_set("status", "Draft")


@frappe.whitelist()
def get_variation_items(boq):
	"""Return RA Bill Item rows for all approved Variation Order lines on a BOQ."""
	vos = frappe.get_all(
		"Variation Order",
		filters={"boq": boq, "docstatus": 1},
		pluck="name",
	)
	rows = []
	for vo_name in vos:
		vo = frappe.get_doc("Variation Order", vo_name)
		for item in vo.items:
			if item.item_type == "Deletion":
				continue
			rows.append(
				{
					"description": item.description,
					"uom": item.uom,
					"rate": item.rate,
					"boq_qty": item.quantity,
					"cumulative_qty": 0,
					"is_extra_item": 1,
					"variation_order": vo_name,
				}
			)
	return rows
