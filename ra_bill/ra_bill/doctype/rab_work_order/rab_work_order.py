# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

# Standard additions/deductions seeded onto a new Work Order. Each RA Bill carries
# these rows forward and computes the actual amount on its billable value.
DEFAULT_ADDITIONS = [
	{"addition_type": "Escalation", "method": "Percentage", "rate": 0.0},
	{"addition_type": "Secured Advance", "method": "Percentage", "rate": 0.0},
]
DEFAULT_DEDUCTIONS = [
	{"deduction_type": "Retention", "method": "Percentage", "rate": 5.0, "cap_percentage": 5.0},
	{"deduction_type": "TDS", "method": "Percentage", "rate": 2.0},
	{"deduction_type": "Labour Cess", "method": "Percentage", "rate": 1.0},
	{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20.0},
]


class RABWorkOrder(Document):
	def validate(self):
		self.calculate_totals()
		if not self.contract_value:
			self.contract_value = self.total_boq_amount

	def before_insert(self):
		self.seed_default_charges()

	def seed_default_charges(self):
		"""Pre-fill the Additions/Deductions tables on a fresh Work Order so the user
		starts from the standard contract terms instead of an empty grid."""
		if not self.get("additions"):
			for row in DEFAULT_ADDITIONS:
				self.append("additions", row)
		if not self.get("deductions"):
			for row in DEFAULT_DEDUCTIONS:
				self.append("deductions", row)

	def calculate_totals(self):
		total = 0.0
		for row in self.items:
			row.amount = flt(row.boq_qty) * flt(row.rate)
			total += row.amount
		self.total_boq_amount = total

	def on_submit(self):
		self.db_set("status", "Active")

	def on_cancel(self):
		self.db_set("status", "Draft")
