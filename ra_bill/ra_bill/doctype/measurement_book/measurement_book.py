# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class MeasurementBook(Document):
	def validate(self):
		for row in self.entries:
			nos = flt(row.nos) or 1
			length = flt(row.length) or 1
			breadth = flt(row.breadth) or 1
			depth = flt(row.depth) or 1
			row.quantity = nos * length * breadth * depth
