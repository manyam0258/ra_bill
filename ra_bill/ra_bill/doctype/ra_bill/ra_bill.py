# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

WORK_ORDER = "RAB Work Order"


def _pct(part, whole):
	return (flt(part) / flt(whole) * 100.0) if flt(whole) else 0.0


class RABill(Document):
	# ------------------------------------------------------------------ #
	# Lifecycle
	# ------------------------------------------------------------------ #
	def validate(self):
		self.set_defaults_from_work_order()
		self.set_previous_ra_bill()
		self.set_ra_bill_no()
		self.fetch_previous_quantities()
		self.calculate_item_amounts()
		self.calculate_child_lines()
		self.calculate_totals()

	def on_submit(self):
		self.update_project_balances(cancel=False)
		frappe.db.set_value(WORK_ORDER, self.boq, "status", "Active")
		self.mark_measurement_books(linked=True)

	def on_cancel(self):
		self.ignore_linked_doctypes = ("GL Entry",)
		self.update_project_balances(cancel=True)
		self.unlink_invoice()
		self.mark_measurement_books(linked=False)

	# ------------------------------------------------------------------ #
	# Setup helpers
	# ------------------------------------------------------------------ #
	def _work_order(self):
		"""Cached Work Order doc for this bill."""
		if not getattr(self, "_wo_doc", None) and self.boq:
			self._wo_doc = frappe.get_cached_doc(WORK_ORDER, self.boq)
		return getattr(self, "_wo_doc", None)

	def set_defaults_from_work_order(self):
		if not self.boq:
			return
		wo = self._work_order()
		self.bill_type = wo.boq_type
		self.billing_method = wo.billing_method or "Item Rate (Measured)"
		self.company = self.company or wo.company
		self.currency = self.currency or wo.currency
		if wo.boq_type == "Client":
			self.customer = wo.customer
			self.supplier = None
		else:
			self.supplier = wo.supplier
			self.customer = None
		# On a new (non-amended) RA Bill, copy the tax flags and the Work Order's
		# Additions/Deductions so the standard charges are always present, even if the
		# user has already added an ad-hoc row. Amendments keep their copied tables.
		if self.is_new() and not self.amended_from and not self.flags.charges_seeded:
			if wo.get("apply_gst") is not None:
				self.apply_gst = wo.apply_gst
			if wo.get("gst_percentage") is not None:
				self.gst_percentage = wo.gst_percentage
			self.seed_charges_from_work_order(wo)
			self.flags.charges_seeded = True

	def seed_charges_from_work_order(self, wo):
		"""Append the Work Order's configured charges, keeping any rows the user
		already added on the bill."""
		for row in wo.additions:
			self.append(
				"additions",
				{
					"addition_type": row.addition_type,
					"description": row.description,
					"method": row.method,
					"rate": row.rate,
					"amount": row.amount,
					"account": row.account,
				},
			)
		for row in wo.deductions:
			self.append(
				"deductions",
				{
					"deduction_type": row.deduction_type,
					"description": row.description,
					"method": row.method,
					"rate": row.rate,
					"amount": row.amount,
					"cap_percentage": row.cap_percentage,
					"account": row.account,
				},
			)

	def set_previous_ra_bill(self):
		"""Auto-pick the latest submitted RA Bill for this Work Order if not chosen."""
		if self.previous_ra_bill or not self.boq:
			return
		previous = frappe.get_all(
			"RA Bill",
			filters={
				"boq": self.boq,
				"docstatus": 1,
				"name": ["!=", self.name or ""],
			},
			order_by="ra_bill_no desc",
			limit=1,
			pluck="name",
		)
		if previous:
			self.previous_ra_bill = previous[0]

	def set_ra_bill_no(self):
		if self.previous_ra_bill:
			prev_no = frappe.db.get_value("RA Bill", self.previous_ra_bill, "ra_bill_no")
			self.ra_bill_no = (flt(prev_no) or 0) + 1
		elif not self.ra_bill_no:
			self.ra_bill_no = 1

	def fetch_previous_quantities(self):
		"""Map each line's previous cumulative qty/percent from the previous RA Bill."""
		prev_qty, prev_pct = {}, {}
		if self.previous_ra_bill:
			prev_doc = frappe.get_doc("RA Bill", self.previous_ra_bill)
			for row in prev_doc.items:
				key = row.boq_item or row.description
				prev_qty[key] = flt(row.cumulative_qty)
				prev_pct[key] = flt(row.cumulative_percent)
		for row in self.items:
			key = row.boq_item or row.description
			row.previous_qty = prev_qty.get(key, 0.0)
			row.previous_percent = prev_pct.get(key, 0.0)

	# ------------------------------------------------------------------ #
	# Calculations
	# ------------------------------------------------------------------ #
	def calculate_item_amounts(self):
		"""Compute per-line amounts based on the billing method.

		Item Rate  -> measured qty x rate (cumulative - previous).
		Percentage / Milestone / Lump Sum -> % complete of the line's contract amount.
		Downward movement (re-measurement / milestone reversal) is allowed and yields a
		negative "this bill" value (a recovery bill).
		"""
		measured = (self.billing_method or "Item Rate (Measured)") == "Item Rate (Measured)"
		tolerance = self._deviation_tolerance()
		for row in self.items:
			row.contract_amount = flt(row.boq_qty) * flt(row.rate)
			if measured:
				row.current_qty = flt(row.cumulative_qty) - flt(row.previous_qty)
				row.current_amount = flt(row.current_qty) * flt(row.rate)
				row.previous_amount = flt(row.previous_qty) * flt(row.rate)
				row.cumulative_amount = flt(row.cumulative_qty) * flt(row.rate)
				row.deviation_qty = flt(row.cumulative_qty) - flt(row.boq_qty)
				row.cumulative_percent = _pct(row.cumulative_amount, row.contract_amount)
				row.previous_percent = _pct(row.previous_amount, row.contract_amount)
				row.current_percent = flt(row.cumulative_percent) - flt(row.previous_percent)
				self._warn_deviation(row, tolerance)
			else:
				row.current_percent = flt(row.cumulative_percent) - flt(row.previous_percent)
				row.previous_amount = flt(row.contract_amount) * flt(row.previous_percent) / 100.0
				row.cumulative_amount = flt(row.contract_amount) * flt(row.cumulative_percent) / 100.0
				row.current_amount = flt(row.contract_amount) * flt(row.current_percent) / 100.0
				row.current_qty = 0.0
				row.deviation_qty = 0.0

	def _deviation_tolerance(self):
		wo = self._work_order()
		return flt(wo.deviation_tolerance_percentage) if wo else 0.0

	def _warn_deviation(self, row, tolerance):
		if row.is_extra_item or not tolerance or not flt(row.boq_qty):
			return
		limit = flt(row.boq_qty) * (1 + tolerance / 100.0)
		if flt(row.cumulative_qty) > limit:
			frappe.msgprint(
				_("Row {0} ({1}): cumulative qty {2} exceeds Work Order qty {3} by more than {4}%. "
				  "A Variation Order may be required.").format(
					row.idx, row.description, flt(row.cumulative_qty), flt(row.boq_qty), tolerance
				),
				indicator="orange",
				title=_("Deviation Warning"),
			)

	def calculate_child_lines(self):
		"""Compute escalation and secured-advance line amounts."""
		for row in self.escalations:
			base = flt(row.base_index)
			factor = ((flt(row.current_index) - base) / base) if base else 0.0
			row.escalation_amount = (
				factor
				* flt(row.quantity)
				* flt(row.base_rate)
				* flt(row.contractor_share_percent)
				/ 100.0
			)
		for row in self.secured_advances:
			row.advance_amount = (
				flt(row.qty_at_site) * flt(row.assessed_rate) * flt(row.reduced_rate_percent) / 100.0
			)

	def calculate_totals(self):
		self.gross_work_value = sum(flt(r.current_amount) for r in self.items)
		self.previous_billed_value = sum(flt(r.previous_amount) for r in self.items)
		self.cumulative_work_value = flt(self.gross_work_value) + flt(self.previous_billed_value)

		# Price escalation adds to the billable (taxable) value of work this bill.
		self.escalation_amount = sum(flt(r.escalation_amount) for r in self.escalations)

		# Secured advance (Part II): net new advance paid (+) or recovered (-) this bill.
		self.secured_advance_current = sum(flt(r.advance_amount) for r in self.secured_advances)
		self.secured_advance_previous = self._previous_secured_advance()
		self.secured_advance_adjustment = (
			flt(self.secured_advance_current) - flt(self.secured_advance_previous)
		)

		# Additions carried forward from the Work Order. Escalation / Secured Advance rows
		# mirror their detail tables (not re-added); Price Adjustment / Other rows add value.
		work_base = flt(self.gross_work_value) + flt(self.escalation_amount)
		self.additions_total = self._compute_additions(work_base)
		self.billable_value = work_base + flt(self.additions_total)
		base = flt(self.billable_value)

		self.advance_balance_before = self.get_project_advance_balance()

		# Deductions carried forward from the Work Order; each row computed on the base.
		sums = self._compute_deductions(base)
		self.labour_cess_amount = sums.get("Labour Cess", 0.0)
		self.retention_amount = sums.get("Retention", 0.0)
		self.tds_amount = sums.get("TDS", 0.0)
		self.mobilization_recovery_amount = sums.get("Mobilization Recovery", 0.0)

		# Taxes — labour cess is part of the GST taxable base (Sec 15(2)(a) CGST).
		if self.apply_gst:
			taxable = base + flt(self.labour_cess_amount)
			self.gst_amount = taxable * flt(self.gst_percentage) / 100.0
		else:
			self.gst_amount = 0.0
		self.total_invoice_value = base + flt(self.labour_cess_amount) + flt(self.gst_amount)

		self.total_deductions = sum(flt(d.amount) for d in self.deductions)
		self.net_payable = (
			flt(self.total_invoice_value)
			- flt(self.total_deductions)
			+ flt(self.secured_advance_adjustment)
		)

	def _compute_additions(self, work_base):
		"""Set each addition row's amount; return the total of generic (non-mirrored) additions."""
		total = 0.0
		for row in self.additions:
			if row.addition_type == "Escalation":
				row.amount = flt(self.escalation_amount)
			elif row.addition_type == "Secured Advance":
				row.amount = flt(self.secured_advance_adjustment)
			elif row.method == "Fixed Amount":
				total += flt(row.amount)
			else:  # Percentage Price Adjustment / Other
				row.amount = flt(work_base) * flt(row.rate) / 100.0
				total += flt(row.amount)
		return total

	def _compute_deductions(self, base):
		"""Set each deduction row's amount; return per-type sums for the summary fields."""
		sums = {"Retention": 0.0, "TDS": 0.0, "Labour Cess": 0.0, "Mobilization Recovery": 0.0}
		for row in self.deductions:
			row.amount = self._deduction_row_amount(row, base)
			if row.deduction_type in sums:
				sums[row.deduction_type] += flt(row.amount)
		return sums

	def _deduction_row_amount(self, row, base):
		if row.method == "Fixed Amount":
			return flt(row.amount)
		rate = flt(row.rate)
		if row.deduction_type == "Retention":
			return self._retention_for_row(row, base)
		if row.deduction_type == "Mobilization Recovery":
			recovery = flt(base) * rate / 100.0
			# Never recover more than the outstanding advance.
			return min(recovery, flt(self.advance_balance_before))
		return flt(base) * rate / 100.0

	def _previous_secured_advance(self):
		if not self.previous_ra_bill:
			return 0.0
		return flt(frappe.db.get_value("RA Bill", self.previous_ra_bill, "secured_advance_current"))

	def _retention_for_row(self, row, base):
		"""Retention for this bill, capped at (cap% x contract value) cumulatively."""
		retention = flt(base) * flt(row.rate) / 100.0
		cap_pct = flt(row.cap_percentage)
		if cap_pct <= 0:
			return retention
		wo = self._work_order()
		contract_value = flt(wo.contract_value) or flt(wo.total_boq_amount)
		if not contract_value:
			return retention
		cap_amount = contract_value * cap_pct / 100.0
		already_held = self._cumulative_retention()
		available = max(0.0, cap_amount - already_held)
		return min(retention, available)

	def _cumulative_retention(self):
		rows = frappe.get_all(
			"RA Bill",
			filters={"boq": self.boq, "docstatus": 1, "name": ["!=", self.name or ""]},
			fields=["sum(retention_amount) as total"],
		)
		return flt(rows[0].total) if rows else 0.0

	# ------------------------------------------------------------------ #
	# Project running balances (mobilization advance + retention)
	# ------------------------------------------------------------------ #
	def get_project_advance_balance(self):
		if not self.project or not frappe.get_meta("Project").has_field("mobilization_balance"):
			return 0.0
		return flt(frappe.db.get_value("Project", self.project, "mobilization_balance"))

	def update_project_balances(self, cancel=False):
		if not self.project or not frappe.get_meta("Project").has_field("mobilization_balance"):
			return
		sign = 1 if cancel else -1
		meta = frappe.get_meta("Project")
		mob_balance = flt(frappe.db.get_value("Project", self.project, "mobilization_balance"))
		ret_balance = flt(frappe.db.get_value("Project", self.project, "retention_balance"))
		mob_balance += sign * flt(self.mobilization_recovery_amount)
		ret_balance += (-sign) * flt(self.retention_amount)
		values = {
			"mobilization_balance": max(mob_balance, 0.0),
			"retention_balance": max(ret_balance, 0.0),
		}
		if meta.has_field("secured_advance_balance"):
			sec_balance = flt(frappe.db.get_value("Project", self.project, "secured_advance_balance"))
			sec_balance += (-sign) * flt(self.secured_advance_adjustment)
			values["secured_advance_balance"] = max(sec_balance, 0.0)
		frappe.db.set_value("Project", self.project, values)

	def mark_measurement_books(self, linked=True):
		if not self.measurement_book:
			return
		ra = self.name if linked else None
		if frappe.db.get_value("Measurement Book", self.measurement_book, "ra_bill") in (None, self.name):
			frappe.db.set_value("Measurement Book", self.measurement_book, "ra_bill", ra)

	# ------------------------------------------------------------------ #
	# Invoice generation (explicit, after certification)
	# ------------------------------------------------------------------ #
	def unlink_invoice(self):
		if self.sales_invoice:
			self.db_set("sales_invoice", None)
		if self.purchase_invoice:
			self.db_set("purchase_invoice", None)

	def _default_item(self):
		item = frappe.db.get_single_value("RA Bill Settings", "default_item")
		if not item:
			frappe.throw(
				_("Set a Default Service Item in RA Bill Settings, or link an Item on each Work Order line.")
			)
		return item

	def _invoice_lines(self):
		lines = []
		default_item = None
		for row in self.items:
			if not flt(row.current_qty):
				continue
			item_code = row.item_code
			if not item_code:
				default_item = default_item or self._default_item()
				item_code = default_item
			lines.append(
				{
					"item_code": item_code,
					"item_name": (row.description or "")[:140],
					"description": row.description,
					"qty": flt(row.current_qty),
					"uom": row.uom,
					"rate": flt(row.rate),
					"cost_center": self.cost_center,
				}
			)
		if not lines:
			frappe.throw(_("No billable quantity in this RA Bill. Nothing to invoice."))
		return lines


@frappe.whitelist()
def get_boq_items(boq, previous_ra_bill=None):
	"""Return RA Bill Item rows seeded from the Work Order, with previous quantities filled."""
	wo_doc = frappe.get_doc(WORK_ORDER, boq)
	prev_map = {}
	prev_pct = {}
	if previous_ra_bill:
		prev_doc = frappe.get_doc("RA Bill", previous_ra_bill)
		for r in prev_doc.items:
			key = r.boq_item or r.description
			prev_map[key] = flt(r.cumulative_qty)
			prev_pct[key] = flt(r.cumulative_percent)

	rows = []
	for item in wo_doc.items:
		prev_qty = prev_map.get(item.name, 0.0)
		prev_p = prev_pct.get(item.name, 0.0)
		rows.append(
			{
				"boq_item": item.name,
				"item_code": item.item_code,
				"description": item.description,
				"uom": item.uom,
				"rate": item.rate,
				"boq_qty": item.boq_qty,
				"contract_amount": flt(item.boq_qty) * flt(item.rate),
				"previous_qty": prev_qty,
				"cumulative_qty": prev_qty,
				"previous_percent": prev_p,
				"cumulative_percent": prev_p,
			}
		)
	return rows


@frappe.whitelist()
def get_mb_quantities(measurement_book):
	"""Return {boq_item_or_description: period_qty} summed from a Measurement Book."""
	mb = frappe.get_doc("Measurement Book", measurement_book)
	totals = {}
	for entry in mb.entries:
		key = entry.boq_item or entry.description
		totals[key] = flt(totals.get(key, 0.0)) + flt(entry.quantity)
	return totals


@frappe.whitelist()
def make_invoice(ra_bill):
	doc = frappe.get_doc("RA Bill", ra_bill)
	if doc.docstatus != 1:
		frappe.throw(_("Submit the RA Bill before generating an invoice."))
	if doc.bill_type == "Client":
		return _make_sales_invoice(doc)
	return _make_purchase_invoice(doc)


def _company_address(company):
	"""Return the company's own address (needed for GST GSTIN resolution)."""
	rows = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Company", "link_name": company, "parenttype": "Address"},
		pluck="parent",
		limit=1,
	)
	return rows[0] if rows else None


def _party_address(party_type, party):
	rows = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": party_type, "link_name": party, "parenttype": "Address"},
		pluck="parent",
		limit=1,
	)
	return rows[0] if rows else None


def _apply_tax_template(invoice, master_doctype, template):
	"""Expand a tax template's rows onto the invoice (server-side creation
	does not auto-expand `taxes_and_charges`)."""
	from erpnext.controllers.accounts_controller import get_taxes_and_charges

	for tax in get_taxes_and_charges(master_doctype, template):
		invoice.append("taxes", tax)


def _address_state(address):
	if not address:
		return None
	return frappe.db.get_value("Address", address, "gst_state")


def _gst_sales_template(company, company_address, party_address):
	"""Pick the in-state (CGST+SGST) or out-state (IGST) GST output template."""
	abbr = frappe.get_cached_value("Company", company, "abbr")
	company_state = _address_state(company_address)
	party_state = _address_state(party_address)
	# Default to in-state when party state is unknown (unregistered / no address).
	in_state = (not party_state) or (party_state == company_state)
	candidate = f"Output GST {'In' if in_state else 'Out'}-state - {abbr}"
	if frappe.db.exists("Sales Taxes and Charges Template", candidate):
		return candidate
	return None


def _make_sales_invoice(doc):
	if doc.sales_invoice:
		frappe.throw(_("Sales Invoice {0} already exists for this RA Bill.").format(doc.sales_invoice))
	si = frappe.new_doc("Sales Invoice")
	si.customer = doc.customer
	si.company = doc.company
	si.project = doc.project
	si.posting_date = doc.posting_date
	si.set_posting_time = 1
	company_address = _company_address(doc.company)
	if company_address and si.meta.has_field("company_address"):
		si.company_address = company_address
	customer_address = _party_address("Customer", doc.customer)
	if customer_address and si.meta.has_field("customer_address"):
		si.customer_address = customer_address
	if doc.apply_gst:
		template = _gst_sales_template(doc.company, company_address, customer_address)
		if template:
			si.taxes_and_charges = template
			_apply_tax_template(si, "Sales Taxes and Charges Template", template)
	if si.meta.has_field("ra_bill"):
		si.ra_bill = doc.name
	for line in doc._invoice_lines():
		si.append("items", line)
	si.insert(ignore_permissions=True)
	doc.db_set("sales_invoice", si.name)
	return si.name


def _make_purchase_invoice(doc):
	if doc.purchase_invoice:
		frappe.throw(_("Purchase Invoice {0} already exists for this RA Bill.").format(doc.purchase_invoice))
	pi = frappe.new_doc("Purchase Invoice")
	pi.supplier = doc.supplier
	pi.company = doc.company
	pi.project = doc.project
	pi.posting_date = doc.posting_date
	pi.set_posting_time = 1
	company_address = _company_address(doc.company)
	if company_address and pi.meta.has_field("billing_address"):
		pi.billing_address = company_address
	supplier_address = _party_address("Supplier", doc.supplier)
	if supplier_address and pi.meta.has_field("supplier_address"):
		pi.supplier_address = supplier_address
	if pi.meta.has_field("ra_bill"):
		pi.ra_bill = doc.name
	if pi.meta.has_field("apply_tds") and flt(doc.tds_amount):
		pi.apply_tds = 1
	for line in doc._invoice_lines():
		pi.append("items", line)
	pi.insert(ignore_permissions=True)
	doc.db_set("purchase_invoice", pi.name)
	return pi.name
