# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

WORK_ORDER = "RAB Work Order"

DEDUCTION_DESCRIPTION_MAP = {
	"Retention": "Retention on Gross Work Value",
	"TDS": "TDS on Gross Work Value",
	"Labour Cess": "Labour Cess on Gross Work Value",
	"Mobilization Recovery": "Mobilization Recovery on Advance Amount",
}


def _pct(part, whole):
	return (flt(part) / flt(whole) * 100.0) if flt(whole) else 0.0


class RABill(Document):
	def validate(self):
		self.ensure_child_methods()
		self.set_defaults_from_work_order()
		self.set_previous_ra_bill()
		self.set_ra_bill_no()
		self.fetch_previous_quantities()
		self.validate_work_order_not_fully_billed()
		self.calculate_item_amounts()
		self.calculate_child_lines()
		self.calculate_totals()

	def ensure_child_methods(self):
		for row in getattr(self, "deductions", []):
			if not getattr(row, "method", None):
				row.method = getattr(row, "calculation_method", None) or "Percentage"
		for row in getattr(self, "additions", []):
			if not getattr(row, "method", None):
				row.method = getattr(row, "calculation_method", None) or "Percentage"


	def on_submit(self):
		self.update_project_balances(cancel=False)
		frappe.db.set_value(WORK_ORDER, self.boq, "status", "Active")
		self.mark_measurement_books(linked=True)

	def on_cancel(self):
		self.ignore_linked_doctypes = ("GL Entry",)
		self.update_project_balances(cancel=True)
		self.unlink_invoice()
		self.mark_measurement_books(linked=False)

	def _work_order(self):
		"""Work Order doc for this bill."""
		if not self.boq:
			return None
		wo = getattr(self, "_wo_doc", None)
		if not wo or getattr(wo, "name", None) != self.boq:
			self._wo_doc = frappe.get_doc(WORK_ORDER, self.boq)
		return self._wo_doc

	def set_defaults_from_work_order(self):
		if not self.boq:
			if self.project and not frappe.db.exists("Project", self.project):
				real_proj = frappe.db.get_value("Project", {"project_name": self.project}, "name") or frappe.db.get_value("Project", {"title": self.project}, "name")
				if real_proj:
					self.project = real_proj
			return
		self.validate_work_order_not_fully_billed()
		wo = self._work_order()
		if wo and wo.project:
			self.project = wo.project
		elif self.project and not frappe.db.exists("Project", self.project):
			real_proj = frappe.db.get_value("Project", {"project_name": self.project}, "name") or frappe.db.get_value("Project", {"title": self.project}, "name")
			if real_proj:
				self.project = real_proj
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

		if self.is_new() and not self.amended_from and not self.flags.charges_seeded:
			if wo.get("apply_gst") is not None:
				self.apply_gst = wo.apply_gst
			if wo.get("gst_percentage") is not None:
				self.gst_percentage = wo.gst_percentage
			self.seed_charges_from_work_order(wo)
			self.flags.charges_seeded = True

		self.link_mobilization_advance_entry()

	def link_mobilization_advance_entry(self):
		if not self.boq:
			return
		mob_pe = self._get_mobilization_advance_payment_entry()
		if not mob_pe:
			return
		for row in self.deductions:
			if row.deduction_type == "Mobilization Recovery" and not row.payment_entry:
				row.payment_entry = mob_pe

	def _get_mobilization_advance_payment_entry(self):
		entries = frappe.db.sql(
			"""
			SELECT pe.name
			FROM `tabPayment Entry` pe
			INNER JOIN `tabPayment Entry Reference` per
				ON per.parent = pe.name
			WHERE
				pe.docstatus = 1
				AND per.reference_doctype = 'RAB Work Order'
				AND per.reference_name = %s
				AND pe.payment_type = 'Pay'
				AND pe.is_mobilization_advance = 1
			ORDER BY pe.creation DESC
			LIMIT 1
			""",
			self.boq,
			pluck="name",
		)
		if entries:
			return entries[0]
		wo_pe = frappe.db.get_value(WORK_ORDER, self.boq, "mobilization_payment_entry")
		if wo_pe and frappe.db.get_value("Payment Entry", wo_pe, "docstatus") == 1:
			return wo_pe
		return None

	def seed_charges_from_work_order(self, wo):
		"""Append the Work Order's configured charges, keeping any rows the user
		already added on the bill."""
		if not self.additions:
			for row in wo.additions:
				self.append(
					"additions",
					{
						"addition_type": row.addition_type,
						"description": row.description,
						"method": getattr(row, "method", None) or getattr(row, "calculation_method", None) or "Percentage",
						"rate": row.rate,
						"amount": row.amount,
						"account": row.account,
					},
				)
		if not self.deductions:
			for row in wo.deductions:
				self.append(
					"deductions",
					{
						"deduction_type": row.deduction_type,
						"description": row.description,
						"method": getattr(row, "method", None) or getattr(row, "calculation_method", None) or "Percentage",
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

	def validate_work_order_not_fully_billed(self):
		if not self.boq:
			return

		wo = self._work_order()
		if not wo or not wo.items:
			return

		# Direct database query for latest submitted RA Bill for this Work Order
		latest_submitted = frappe.get_all(
			"RA Bill",
			filters={
				"boq": self.boq,
				"docstatus": 1,
				"name": ["!=", self.name or ""],
			},
			order_by="ra_bill_no desc, creation desc",
			limit=1,
			pluck="name",
		)
		if not latest_submitted:
			return

		prev_doc = frappe.get_doc("RA Bill", latest_submitted[0])
		prev_qty_map = {}
		prev_pct_map = {}
		for r in prev_doc.items:
			key = r.boq_item or r.description
			prev_qty_map[key] = flt(r.cumulative_qty)
			prev_pct_map[key] = flt(r.cumulative_percent)

		billing_method = self.billing_method or wo.billing_method or "Item Rate (Measured)"
		measured = billing_method == "Item Rate (Measured)"
		tol = self._deviation_tolerance()

		all_completed = True
		for item in wo.items:
			key = item.name or item.description
			limit = flt(item.boq_qty) * (1.0 + tol / 100.0)
			if measured:
				p_qty = prev_qty_map.get(key, 0.0)
				if limit > 0 and p_qty < (limit - 1e-6):
					all_completed = False
					break
			else:
				p_pct = prev_pct_map.get(key, 0.0)
				pct_limit = 100.0 * (1.0 + tol / 100.0)
				if p_pct < (pct_limit - 1e-6):
					all_completed = False
					break

		contract_val = (flt(wo.contract_value) or flt(wo.total_boq_amount)) * (1.0 + tol / 100.0)
		prev_work_val = flt(prev_doc.cumulative_work_value)

		if (wo.items and all_completed) or (contract_val > 0 and prev_work_val >= (contract_val - 1e-6)):
			frappe.throw(
				_("This Work Order {0} has already been fully billed. No further RA Bills can be created.").format(
					self.boq
				)
			)

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
		if not self.boq:
			return 0.0
		val = frappe.db.get_value(WORK_ORDER, self.boq, "deviation_tolerance_percentage")
		if val is not None:
			return flt(val)
		wo = self._work_order()
		return flt(wo.deviation_tolerance_percentage) if wo else 0.0

	def _warn_deviation(self, row, tolerance):
		if row.is_extra_item or not flt(row.boq_qty):
			return
		tol = flt(tolerance)
		limit = flt(row.boq_qty) * (1.0 + tol / 100.0)
		if flt(row.cumulative_qty) > (limit + 1e-6):
			item_name = row.item_code or row.description or _("Row #{0}").format(row.idx)
			disp_limit = round(limit, 4)
			if disp_limit == int(disp_limit):
				disp_limit = int(disp_limit)
			disp_cum = round(flt(row.cumulative_qty), 4)
			if disp_cum == int(disp_cum):
				disp_cum = int(disp_cum)
			disp_boq = round(flt(row.boq_qty), 4)
			if disp_boq == int(disp_boq):
				disp_boq = int(disp_boq)
			disp_tol = round(tol, 2)
			if disp_tol == int(disp_tol):
				disp_tol = int(disp_tol)

			if tol > 0:
				msg = _(
					"Row #{0} ({1}): Cumulative quantity {2} exceeds the Work Order contracted quantity of {3} "
					"(allowed limit with {4}% deviation tolerance is {5}). "
					"A Variation Order is required to proceed beyond this limit."
				).format(row.idx, item_name, disp_cum, disp_boq, disp_tol, disp_limit)
			else:
				msg = _(
					"Row #{0} ({1}): Cumulative quantity {2} exceeds the Work Order contracted quantity of {3}. "
					"A Variation Order is required to proceed beyond this limit."
				).format(row.idx, item_name, disp_cum, disp_boq)
			frappe.throw(msg, title=_("Quantity Exceeds Work Order Limit"))

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

		self.escalation_amount = sum(flt(r.escalation_amount) for r in self.escalations)

		self.secured_advance_current = sum(flt(r.advance_amount) for r in self.secured_advances)
		self.secured_advance_previous = self._previous_secured_advance()
		self.secured_advance_adjustment = (
			flt(self.secured_advance_current) - flt(self.secured_advance_previous)
		)

		work_base = flt(self.gross_work_value) + flt(self.escalation_amount)
		self.additions_total = self._compute_additions(work_base)
		self.billable_value = work_base + flt(self.additions_total)
		base = flt(self.billable_value)

		self.advance_balance_before = self.get_project_advance_balance()

		sums = self._compute_deductions(base)
		labour_cess = sums.get("Labour Cess", 0.0)
		self.retention_amount = sums.get("Retention", 0.0)
		self.tds_amount = sums.get("TDS", 0.0)
		self.mobilization_recovery_amount = sums.get("Mobilization Recovery", 0.0)

		if self.apply_gst:
			taxable = base
			self.gst_amount = taxable * flt(self.gst_percentage) / 100.0
		else:
			self.gst_amount = 0.0
		self.total_invoice_value = base + flt(self.gst_amount)

		self.total_deductions = sum(
			flt(d.amount)
    		for d in self.deductions
		)

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

	def _is_advance_recovery_type(self, dt, desc=None):
		if not dt:
			return False
		dt = dt.strip()
		desc = (desc or "").strip()
		return (
			dt in ("Mobilization Recovery", "Mobilization Advance Recovery", "Ad Hoc Advance Recovery", "Ad Hoc Advance", "Advance Recovery")
			or dt.startswith("Other -")
			or (dt == "Other" and (desc.startswith("Other -") or "advance" in desc.lower()))
		)

	def _get_advance_name(self, row):
		dt = (getattr(row, "deduction_type", None) or "").strip()
		desc = (getattr(row, "description", None) or "").strip()
		if dt in ("Mobilization Recovery", "Mobilization Advance Recovery") or desc in ("Mobilization Advance", "Mobilization Advance Recovery"):
			return _("Mobilization Advance")
		if dt in ("Advance Recovery", "Ad Hoc Advance Recovery", "Ad Hoc Advance") or desc in ("Ad Hoc Advance", "Ad Hoc Advance Recovery"):
			return _("Ad Hoc Advance")
		if desc.startswith("Other -"):
			return desc
		if dt.startswith("Other -"):
			return dt
		if desc and "advance" in desc.lower():
			return desc
		if dt:
			return dt
		return _("Advance")

	def _compute_deductions(self, base):
		"""Set each deduction row's amount and description; return per-type sums for the summary fields."""
		sums = {"Retention": 0.0, "TDS": 0.0, "Labour Cess": 0.0, "Mobilization Recovery": 0.0}
		for row in self.deductions:
			if not row.description and row.deduction_type in DEDUCTION_DESCRIPTION_MAP:
				row.description = DEDUCTION_DESCRIPTION_MAP[row.deduction_type]
			row.amount = self._deduction_row_amount(row, base)
			if row.deduction_type in sums:
				sums[row.deduction_type] += flt(row.amount)
			elif self._is_advance_recovery_type(row.deduction_type, row.description):
				sums["Mobilization Recovery"] += flt(row.amount)
		return sums

	def _deduction_row_amount(self, row, base):
		if row.method == "Fixed Amount":
			return flt(row.amount)

		rate = flt(row.rate)
		if row.deduction_type == "Retention":
			return self._retention_for_row(row, base)
		if row.deduction_type == "Mobilization Recovery" or self._is_advance_recovery_type(row.deduction_type, row.description):
			mob_advance = self.get_project_original_mobilization_advance(row)
			recovery = mob_advance * rate / 100.0
			remaining = self.get_project_advance_balance(row)
			if recovery > (remaining + 0.005):
				adv_name = self._get_advance_name(row)
				msg = _(
					"Row #{0} ({1}): {2} recovery rate of {3}% would recover {4}, "
					"but only {5} of this advance remains. Please correct the rate to avoid over-recovery."
				).format(
					row.idx,
					row.description or row.deduction_type,
					adv_name,
					rate,
					frappe.format_value(recovery, "Currency"),
					frappe.format_value(remaining, "Currency"),
				)
				frappe.throw(msg, title=_("Advance Over-Recovery"))
			return min(recovery, remaining) if remaining > 0 else 0.0
		return flt(base) * rate / 100.0

	def _previous_secured_advance(self):
		if not self.previous_ra_bill:
			return 0.0
		return flt(frappe.db.get_value("RA Bill", self.previous_ra_bill, "secured_advance_current"))

	def _retention_for_row(self, row, base):
		"""Retention for this bill, capped at (cap% x contract value) cumulatively."""
		retention = flt(base) * flt(row.rate) / 100.0
		cap_pct = flt(row.cap_percentage)
		if not cap_pct:
			return retention
		contract_value = flt(frappe.db.get_value(WORK_ORDER, self.boq, "contract_value"))
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

	def _cumulative_mobilization_recovered(self, include_self=False, row=None):
		if not self.boq:
			return 0.0
		params = [self.boq]
		type_filter = """
			(
				ded.deduction_type IN ('Mobilization Recovery', 'Mobilization Advance Recovery', 'Ad Hoc Advance Recovery', 'Ad Hoc Advance', 'Advance Recovery')
				OR ded.deduction_type LIKE 'Other -%%'
				OR (ded.deduction_type = 'Other' AND (ded.description LIKE 'Other -%%' OR LOWER(ded.description) LIKE '%%advance%%'))
			)
		"""
		if row:
			dt = (getattr(row, "deduction_type", None) or "").strip()
			desc = (getattr(row, "description", None) or "").strip()
			if dt in ("Mobilization Recovery", "Mobilization Advance Recovery") or desc in ("Mobilization Advance", "Mobilization Advance Recovery"):
				type_filter = "(ded.deduction_type IN ('Mobilization Recovery', 'Mobilization Advance Recovery') OR ded.description IN ('Mobilization Advance', 'Mobilization Advance Recovery'))"
			elif dt in ("Advance Recovery", "Ad Hoc Advance Recovery", "Ad Hoc Advance") or desc in ("Ad Hoc Advance", "Ad Hoc Advance Recovery"):
				type_filter = "(ded.deduction_type IN ('Advance Recovery', 'Ad Hoc Advance Recovery', 'Ad Hoc Advance') OR ded.description IN ('Ad Hoc Advance', 'Ad Hoc Advance Recovery'))"
			elif dt.startswith("Other -") or dt == "Other":
				if desc:
					type_filter = "(ded.deduction_type = %s OR ded.description = %s)"
					params.extend([dt, desc])
				else:
					type_filter = "(ded.deduction_type LIKE 'Other -%%' OR ded.deduction_type = 'Other')"

		where_clause = f"rab.docstatus = 1 AND rab.boq = %s AND {type_filter}"
		if not include_self and self.name:
			where_clause += " AND rab.name != %s"
			params.append(self.name)
		rows = frappe.db.sql(
			f"""
			SELECT COALESCE(SUM(ded.amount), 0)
			FROM `tabRA Bill Deduction` ded
			INNER JOIN `tabRA Bill` rab ON rab.name = ded.parent
			WHERE {where_clause}
			""",
			tuple(params),
		)
		return flt(rows[0][0]) if rows else 0.0

	def get_project_original_mobilization_advance(self, row=None):
		if not self.boq:
			return 0.0

		# 1. Direct query on tabRAB Work Order Advance child table
		dt = (getattr(row, "deduction_type", None) or "").strip()
		desc = (getattr(row, "description", None) or "").strip()
		adv_type = None
		adv_desc = None
		if dt in ("Mobilization Recovery", "Mobilization Advance Recovery") or desc in ("Mobilization Advance", "Mobilization Advance Recovery"):
			adv_type = "Mobilization Advance"
		elif dt in ("Advance Recovery", "Ad Hoc Advance Recovery", "Ad Hoc Advance") or desc in ("Ad Hoc Advance", "Ad Hoc Advance Recovery"):
			adv_type = "Ad Hoc Advance"
		elif dt.startswith("Other -") or dt == "Other":
			adv_type = "Other"
			if desc.startswith("Other -"):
				adv_desc = desc.replace("Other -", "").strip()
			elif dt.startswith("Other -"):
				adv_desc = dt.replace("Other -", "").strip()

		if adv_type:
			if adv_desc:
				adv_rows = frappe.db.sql(
					"""
					SELECT COALESCE(SUM(amount), 0.0)
					FROM `tabRAB Work Order Advance`
					WHERE parent = %s AND parenttype = 'RAB Work Order' AND advance_type = 'Other'
					  AND (description = %s OR description = '' OR description IS NULL)
					""",
					(self.boq, adv_desc),
				)
			else:
				adv_rows = frappe.db.sql(
					"""
					SELECT COALESCE(SUM(amount), 0.0)
					FROM `tabRAB Work Order Advance`
					WHERE parent = %s AND parenttype = 'RAB Work Order' AND advance_type = %s
					""",
					(self.boq, adv_type),
				)
			total_adv = flt(adv_rows[0][0]) if adv_rows else 0.0
			if total_adv > 0:
				return total_adv

		all_adv_rows = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(amount), 0.0)
			FROM `tabRAB Work Order Advance`
			WHERE parent = %s AND parenttype = 'RAB Work Order'
			""",
			(self.boq,),
		)
		total_all_adv = flt(all_adv_rows[0][0]) if all_adv_rows else 0.0
		if total_all_adv > 0:
			return total_all_adv

		# 2. Check advances child table on in-memory work order if loaded
		wo = self._work_order()
		if wo and getattr(wo, "advances", None):
			adv_sum = sum(flt(adv.amount) for adv in wo.advances if getattr(adv, "advance_type", None) == "Mobilization Advance")
			if adv_sum > 0:
				return adv_sum

		# 3. Sum direct Payment Entries linked via work_order field
		pe_direct = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(paid_amount), 0.0)
			FROM `tabPayment Entry`
			WHERE work_order = %s AND is_mobilization_advance = 1 AND docstatus = 1
			""",
			(self.boq,),
		)
		total_pe_direct = flt(pe_direct[0][0]) if pe_direct else 0.0
		if total_pe_direct > 0:
			return total_pe_direct

		# 4. Sum all submitted Payment Entries linked via Payment Entry Reference
		pe_rows = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(COALESCE(per.allocated_amount, pe.paid_amount)), 0.0)
			FROM `tabPayment Entry` pe
			INNER JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE pe.docstatus = 1
			  AND pe.payment_type = 'Pay'
			  AND pe.is_mobilization_advance = 1
			  AND per.reference_doctype = 'RAB Work Order'
			  AND per.reference_name = %s
			""",
			(self.boq,),
		)
		total_pe_advance = flt(pe_rows[0][0]) if pe_rows else 0.0
		if total_pe_advance > 0:
			return total_pe_advance

		# 5. Check if single mobilization_payment_entry is linked on RAB Work Order
		if wo and getattr(wo, "mobilization_payment_entry", None):
			pe_docstatus = frappe.db.get_value("Payment Entry", wo.mobilization_payment_entry, "docstatus")
			if pe_docstatus == 1:
				return flt(frappe.db.get_value("Payment Entry", wo.mobilization_payment_entry, "paid_amount"))

		# 6. Fallback to RAB Work Order's mobilization_advance_amount (for historical/test data)
		if wo:
			return flt(getattr(wo, "mobilization_advance_amount", 0.0))

		return 0.0

	def get_project_advance_balance(self, row=None, include_self=None):
		if include_self is None:
			include_self = (self.docstatus == 1)
		mob_advance = self.get_project_original_mobilization_advance(row)
		already_recovered = self._cumulative_mobilization_recovered(include_self=include_self, row=row)
		return max(0.0, mob_advance - already_recovered)

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
	if not previous_ra_bill and boq:
		previous = frappe.get_all(
			"RA Bill",
			filters={"boq": boq, "docstatus": 1},
			order_by="ra_bill_no desc, creation desc",
			limit=1,
			pluck="name",
		)
		if previous:
			previous_ra_bill = previous[0]

	wo_doc = frappe.get_doc(WORK_ORDER, boq)
	prev_map = {}
	prev_pct = {}
	if previous_ra_bill:
		prev_doc = frappe.get_doc("RA Bill", previous_ra_bill)
		for r in prev_doc.items:
			if r.boq_item:
				prev_map[r.boq_item] = flt(r.cumulative_qty)
				prev_pct[r.boq_item] = flt(r.cumulative_percent)
			if r.description:
				prev_map[r.description] = flt(r.cumulative_qty)
				prev_pct[r.description] = flt(r.cumulative_percent)

	rows = []
	for item in wo_doc.items:
		prev_qty = prev_map.get(item.name, prev_map.get(item.description, 0.0))
		prev_p = prev_pct.get(item.name, prev_pct.get(item.description, 0.0))
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


def _gst_purchase_template(company, company_address, party_address):
	"""Pick the in-state (CGST+SGST) or out-state (IGST) GST input template for Purchase Invoice."""
	abbr = frappe.get_cached_value("Company", company, "abbr")
	company_state = _address_state(company_address)
	party_state = _address_state(party_address)
	in_state = (not party_state) or (party_state == company_state)
	candidate = f"Input GST {'In' if in_state else 'Out'}-state - {abbr}"
	if frappe.db.exists("Purchase Taxes and Charges Template", candidate):
		return candidate
	candidates = [
		f"Input Tax GST {'In' if in_state else 'Out'}-state - {abbr}",
		f"In-State GST - {abbr}" if in_state else f"Out-State GST - {abbr}",
	]
	for c in candidates:
		if frappe.db.exists("Purchase Taxes and Charges Template", c):
			return c
	return frappe.db.get_value("Purchase Taxes and Charges Template", {"company": company, "disabled": 0}, "name")


def _gst_sales_template(company, company_address, party_address):
	"""Pick the in-state (CGST+SGST) or out-state (IGST) GST output template."""
	abbr = frappe.get_cached_value("Company", company, "abbr")
	company_state = _address_state(company_address)
	party_state = _address_state(party_address)
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
	if doc.apply_gst:
		template = _gst_purchase_template(doc.company, company_address, supplier_address)
		if template:
			pi.taxes_and_charges = template
			_apply_tax_template(pi, "Purchase Taxes and Charges Template", template)
		else:
			tax_acc = (
				frappe.db.get_value("Account", {"company": doc.company, "account_type": "Tax", "is_group": 0}, "name")
				or frappe.db.get_value("Account", {"company": doc.company, "account_name": ["like", "%Tax%"], "is_group": 0}, "name")
			)
			if tax_acc:
				pi.append(
					"taxes",
					{
						"charge_type": "On Net Total",
						"account_head": tax_acc,
						"description": f"GST {flt(doc.gst_percentage)}%",
						"rate": flt(doc.gst_percentage),
						"category": "Total",
					},
				)
	if pi.meta.has_field("ra_bill"):
		pi.ra_bill = doc.name
	if pi.meta.has_field("apply_tds") and flt(doc.tds_amount):
		pi.apply_tds = 1
	for line in doc._invoice_lines():
		pi.append("items", line)

	from ra_bill.api.purchase_invoice import sync_ra_bill_deductions
	sync_ra_bill_deductions(pi)

	pi.insert(ignore_permissions=True)
	doc.db_set("purchase_invoice", pi.name)
	return pi.name

@frappe.whitelist()
def get_advances(boq):
    """
    Returns remaining unrecovered advances for this Work Order.
    """

    advances = []

    payment_entries = frappe.db.sql(
        """
        SELECT
            pe.name,
            pe.paid_amount
        FROM `tabPayment Entry` pe
        INNER JOIN `tabPayment Entry Reference` per
            ON per.parent = pe.name
        WHERE
            pe.docstatus = 1
            AND per.reference_doctype = 'RAB Work Order'
            AND per.reference_name = %s
            AND pe.payment_type = 'Pay'
            AND COALESCE(pe.is_mobilization_advance, 0) = 0
        """,
        boq,
        as_dict=True,
    )

    for pe in payment_entries:

        recovered = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(ded.amount),0)
			FROM `tabRA Bill Deduction` ded
			INNER JOIN `tabRA Bill` rab
				ON rab.name = ded.parent
			WHERE
				rab.docstatus != 2
				AND rab.boq = %s
				AND ded.payment_entry = %s
			""",
			(
				boq,
				pe.name,
			),
		)[0][0]

        balance = flt(pe.paid_amount) - flt(recovered)

        if balance > 0:
            advances.append({
                "payment_entry": pe.name,
                "paid_amount": flt(pe.paid_amount),
                "recovered_amount": flt(recovered),
                "balance_amount": flt(balance),
            })

    return advances 	