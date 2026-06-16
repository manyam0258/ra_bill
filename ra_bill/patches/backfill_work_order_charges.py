# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt
"""Backfill the Additions/Deductions child tables introduced when BOQ became
RAB Work Order and the scalar contract-term fields were replaced by config tables.

- Work Orders: build Deduction rows (Retention/TDS/Labour Cess/Mobilization Recovery)
  from the pre-migration scalar snapshot, plus default Addition rows.
- Draft RA Bills: seed Additions/Deductions from their Work Order so they recompute
  correctly on the next save (Percentage rows).
- Submitted RA Bills: add Fixed-amount statutory Deduction rows from the stored summary
  amounts so the memorandum print keeps showing the retention/TDS/cess/mobilization lines.

Idempotent: each table is only populated when empty / missing its statutory rows.
"""

import frappe
from frappe.utils import flt

WO = "RAB Work Order"


def execute():
	if not frappe.db.has_column("RAB Work Order Deduction", "method"):
		return
	_backfill_work_orders()
	_backfill_ra_bills()
	frappe.db.commit()


def _backfill_work_orders():
	for wo in frappe.get_all(WO, pluck="name"):
		terms = _wo_terms(wo)
		if not _has_children(wo, WO, "RAB Work Order Deduction"):
			_add_rows(
				wo,
				WO,
				"deductions",
				"RAB Work Order Deduction",
				[
					{
						"deduction_type": "Retention",
						"method": "Percentage",
						"rate": flt(terms.get("retention_percentage")),
						"cap_percentage": flt(terms.get("retention_cap_percentage")),
					},
					{"deduction_type": "TDS", "method": "Percentage", "rate": flt(terms.get("tds_percentage"))},
					{"deduction_type": "Labour Cess", "method": "Percentage", "rate": flt(terms.get("labour_cess_percentage"))},
					{
						"deduction_type": "Mobilization Recovery",
						"method": "Percentage",
						"rate": flt(terms.get("mobilization_recovery_percentage")),
					},
				],
			)
		if not _has_children(wo, WO, "RAB Work Order Addition"):
			_add_rows(
				wo,
				WO,
				"additions",
				"RAB Work Order Addition",
				[
					{"addition_type": "Escalation", "method": "Percentage", "rate": 0},
					{"addition_type": "Secured Advance", "method": "Percentage", "rate": 0},
				],
			)


def _backfill_ra_bills():
	bills = frappe.get_all(
		"RA Bill",
		fields=[
			"name",
			"docstatus",
			"boq",
			"retention_amount",
			"tds_amount",
			"labour_cess_amount",
			"mobilization_recovery_amount",
		],
	)
	for bill in bills:
		if not bill.boq:
			continue

		if not _has_children(bill.name, "RA Bill", "RA Bill Addition"):
			wo_adds = frappe.get_all(
				"RAB Work Order Addition",
				filters={"parent": bill.boq, "parenttype": WO},
				fields=["addition_type", "description", "method", "rate", "amount", "account"],
				order_by="idx",
			)
			if wo_adds:
				_add_rows(bill.name, "RA Bill", "additions", "RA Bill Addition", wo_adds)

		has_statutory = frappe.db.exists(
			"RA Bill Deduction",
			{"parent": bill.name, "parenttype": "RA Bill", "deduction_type": "Retention"},
		)
		if has_statutory:
			continue

		if bill.docstatus == 1:
			# Historical bill: reconstruct statutory lines from the stored amounts (display only).
			rows = [
				{"deduction_type": dtype, "method": "Fixed Amount", "amount": flt(amt)}
				for dtype, amt in (
					("Retention", bill.retention_amount),
					("TDS", bill.tds_amount),
					("Labour Cess", bill.labour_cess_amount),
					("Mobilization Recovery", bill.mobilization_recovery_amount),
				)
				if flt(amt)
			]
			if rows:
				_add_rows(bill.name, "RA Bill", "deductions", "RA Bill Deduction", rows)
		else:
			# Draft bill: seed Percentage rows from the Work Order so it recomputes correctly.
			wo_deds = frappe.get_all(
				"RAB Work Order Deduction",
				filters={"parent": bill.boq, "parenttype": WO},
				fields=["deduction_type", "description", "method", "rate", "amount", "cap_percentage", "account"],
				order_by="idx",
			)
			if wo_deds:
				_add_rows(bill.name, "RA Bill", "deductions", "RA Bill Deduction", wo_deds)


# ---------------------------------------------------------------------------- #
TERM_COLUMNS = (
	"retention_percentage",
	"retention_cap_percentage",
	"mobilization_recovery_percentage",
	"labour_cess_percentage",
	"tds_percentage",
)


def _wo_terms(wo):
	"""Read the legacy scalar term values straight from the (now orphan) columns.

	Frappe does not drop removed columns on migrate, so the pre-change values are
	still readable on any upgrading site. Returns {} when the columns are gone."""
	present = [c for c in TERM_COLUMNS if frappe.db.has_column(WO, c)]
	if not present:
		return {}
	return frappe.db.get_value(WO, wo, present, as_dict=True) or {}


def _has_children(parent, parenttype, child_doctype):
	return bool(frappe.db.exists(child_doctype, {"parent": parent, "parenttype": parenttype}))


def _add_rows(parent, parenttype, parentfield, child_doctype, rows):
	start = frappe.db.count(child_doctype, {"parent": parent, "parenttype": parenttype})
	for offset, values in enumerate(rows, start=1):
		frappe.get_doc(
			{
				"doctype": child_doctype,
				"parent": parent,
				"parenttype": parenttype,
				"parentfield": parentfield,
				"idx": start + offset,
				**dict(values),
			}
		).insert(ignore_permissions=True)
