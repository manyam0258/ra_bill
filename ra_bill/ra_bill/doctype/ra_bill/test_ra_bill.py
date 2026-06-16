# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from ra_bill.ra_bill.doctype.ra_bill.ra_bill import get_boq_items, make_invoice


def _company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all(
		"Company", limit=1, pluck="name"
	)[0]


def _ensure_customer():
	name = "RA Test Customer"
	if not frappe.db.exists("Customer", name):
		cg = frappe.db.get_value("Customer Group", {"is_group": 0}, "name") or "All Customer Groups"
		frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": name,
				"customer_group": cg,
				"territory": "All Territories",
			}
		).insert(ignore_permissions=True)
	return name


class TestRABill(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = _company()
		cls.customer = _ensure_customer()

	# --- helpers -----------------------------------------------------
	def _project(self, mob=0.0):
		p = frappe.get_doc(
			{
				"doctype": "Project",
				"project_name": "RA Test " + frappe.generate_hash(length=6),
				"company": self.company,
				"mobilization_advance": mob,
				"mobilization_balance": mob,
				"retention_balance": 0,
			}
		).insert(ignore_permissions=True)
		return p.name

	def _boq(self, project, items, **kw):
		# Translate the legacy scalar term kwargs into Deduction rows on the Work Order.
		retention = kw.pop("retention_percentage", 0)
		retention_cap = kw.pop("retention_cap_percentage", 0)
		tds = kw.pop("tds_percentage", 0)
		cess = kw.pop("labour_cess_percentage", 0)
		mob = kw.pop("mobilization_recovery_percentage", 0)
		doc = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Client",
				"customer": self.customer,
				"company": self.company,
				"apply_gst": 0,
				"items": items,
				"deductions": [
					{"deduction_type": "Retention", "method": "Percentage", "rate": retention, "cap_percentage": retention_cap},
					{"deduction_type": "TDS", "method": "Percentage", "rate": tds},
					{"deduction_type": "Labour Cess", "method": "Percentage", "rate": cess},
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": mob},
				],
				**kw,
			}
		)
		doc.insert(ignore_permissions=True)
		doc.submit()
		return doc

	def _ra(self, boq, previous=None):
		ra = frappe.get_doc({"doctype": "RA Bill", "project": boq.project, "boq": boq.name})
		for r in get_boq_items(boq.name, previous):
			ra.append("items", r)
		ra.insert(ignore_permissions=True)
		return ra

	# --- tests -------------------------------------------------------
	def test_item_rate_cumulative(self):
		project = self._project()
		boq = self._boq(
			project,
			[
				{"description": "Excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300},
				{"description": "Concrete", "uom": "Unit", "boq_qty": 500, "rate": 6000},
			],
		)
		ra1 = self._ra(boq)
		ra1.items[0].cumulative_qty = 400
		ra1.items[1].cumulative_qty = 100
		ra1.save()
		self.assertEqual(flt(ra1.gross_work_value), 720000)
		ra1.submit()

		ra2 = self._ra(boq, ra1.name)
		self.assertEqual(flt(ra2.items[0].previous_qty), 400)
		ra2.items[0].cumulative_qty = 700
		ra2.items[1].cumulative_qty = 250
		ra2.save()
		self.assertEqual(flt(ra2.items[0].current_qty), 300)
		self.assertEqual(flt(ra2.gross_work_value), 990000)
		self.assertEqual(flt(ra2.previous_billed_value), 720000)

	def test_percentage_billing(self):
		project = self._project()
		boq = self._boq(
			project,
			[
				{"description": "Superstructure", "uom": "Unit", "boq_qty": 1, "rate": 1000000},
				{"description": "Finishing", "uom": "Unit", "boq_qty": 1, "rate": 500000},
			],
			billing_method="Percentage Completion",
		)
		ra1 = self._ra(boq)
		ra1.items[0].cumulative_percent = 30
		ra1.save()
		self.assertEqual(flt(ra1.gross_work_value), 300000)
		ra1.submit()

		ra2 = self._ra(boq, ra1.name)
		ra2.items[0].cumulative_percent = 60
		ra2.items[1].cumulative_percent = 20
		ra2.save()
		self.assertEqual(flt(ra2.items[0].previous_percent), 30)
		# 30% of 1,000,000 + 20% of 500,000 = 300,000 + 100,000
		self.assertEqual(flt(ra2.gross_work_value), 400000)

	def test_retention_cap(self):
		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Work", "uom": "Unit", "boq_qty": 1000, "rate": 1000}],
			contract_value=1000000,
			retention_percentage=10,
			retention_cap_percentage=5,  # cap = 50,000
		)

		def bill(prev, cum):
			ra = self._ra(boq, prev)
			ra.items[0].cumulative_qty = cum
			ra.save()
			ra.submit()
			return ra

		r1 = bill(None, 300)  # gross 300k -> 30k
		self.assertEqual(flt(r1.retention_amount), 30000)
		r2 = bill(r1.name, 700)  # gross 400k -> would be 40k, capped to 20k
		self.assertEqual(flt(r2.retention_amount), 20000)
		r3 = bill(r2.name, 800)  # gross 100k -> capped to 0
		self.assertEqual(flt(r3.retention_amount), 0)

	def test_mobilization_recovery_capped_to_balance(self):
		project = self._project(mob=200000)
		boq = self._boq(
			project,
			[{"description": "Work", "uom": "Unit", "boq_qty": 1000, "rate": 1000}],
			mobilization_recovery_percentage=20,
		)
		r1 = self._ra(boq)
		r1.items[0].cumulative_qty = 720
		r1.save()
		self.assertEqual(flt(r1.mobilization_recovery_amount), 144000)  # 20% of 720k
		r1.submit()
		self.assertEqual(flt(frappe.db.get_value("Project", project, "mobilization_balance")), 56000)

		r2 = self._ra(boq, r1.name)
		r2.items[0].cumulative_qty = 1000
		r2.save()
		# 20% of 280k = 56k, but balance is only 56k -> exactly 56k
		self.assertEqual(flt(r2.mobilization_recovery_amount), 56000)
		r2.submit()
		self.assertEqual(flt(frappe.db.get_value("Project", project, "mobilization_balance")), 0)

	def test_escalation_adds_to_billable(self):
		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300}],
		)
		ra = self._ra(boq)
		ra.items[0].cumulative_qty = 400  # gross 120,000
		# factor (110-100)/100 = 0.1; 0.1 * 10 * 50,000 * 85% = 42,500
		ra.append(
			"escalations",
			{
				"description": "Steel",
				"quantity": 10,
				"base_rate": 50000,
				"base_index": 100,
				"current_index": 110,
				"contractor_share_percent": 85,
			},
		)
		ra.save()
		self.assertEqual(flt(ra.escalation_amount), 42500)
		self.assertEqual(flt(ra.billable_value), 162500)
		self.assertEqual(flt(ra.net_payable), 162500)  # no taxes/deductions on this BOQ

	def test_secured_advance_adjustment_and_recovery(self):
		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Work", "uom": "Unit", "boq_qty": 1000, "rate": 300}],
		)
		ra1 = self._ra(boq)
		ra1.items[0].cumulative_qty = 400  # gross 120,000
		ra1.append(
			"secured_advances",
			{"material": "Steel", "qty_at_site": 100, "assessed_rate": 1000, "reduced_rate_percent": 90},
		)
		ra1.save()
		self.assertEqual(flt(ra1.secured_advance_current), 90000)  # 100 * 1000 * 90%
		self.assertEqual(flt(ra1.secured_advance_adjustment), 90000)
		self.assertEqual(flt(ra1.net_payable), 210000)  # 120,000 + 90,000 advance
		ra1.submit()
		self.assertEqual(
			flt(frappe.db.get_value("Project", project, "secured_advance_balance")), 90000
		)

		# Next bill: no materials at site -> recovery of the full secured advance.
		ra2 = self._ra(boq, ra1.name)
		ra2.items[0].cumulative_qty = 700  # this bill gross 90,000
		ra2.save()
		self.assertEqual(flt(ra2.secured_advance_previous), 90000)
		self.assertEqual(flt(ra2.secured_advance_adjustment), -90000)
		self.assertEqual(flt(ra2.net_payable), 0)  # 90,000 - 90,000 recovery
		ra2.submit()
		self.assertEqual(flt(frappe.db.get_value("Project", project, "secured_advance_balance")), 0)

	def test_variation_order_items_flow(self):
		from ra_bill.ra_bill.doctype.variation_order.variation_order import get_variation_items

		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300}],
		)
		vo = frappe.get_doc(
			{
				"doctype": "Variation Order",
				"project": project,
				"boq": boq.name,
				"title": "Extra retaining wall",
				"items": [
					{
						"item_type": "New Item",
						"description": "RCC retaining wall",
						"uom": "Unit",
						"quantity": 10,
						"rate": 5000,
						"pricing_basis": "Negotiated",
					}
				],
			}
		)
		vo.insert(ignore_permissions=True)
		self.assertEqual(flt(vo.cost_impact), 50000)
		vo.submit()
		self.assertEqual(vo.status, "Approved")

		rows = get_variation_items(boq.name)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["variation_order"], vo.name)
		self.assertEqual(rows[0]["is_extra_item"], 1)

		# Bill the BOQ item + the variation item.
		ra = self._ra(boq)
		ra.items[0].cumulative_qty = 400  # 120,000
		ra.append("items", rows[0])
		ra.items[1].cumulative_qty = 10  # 10 * 5,000 = 50,000
		ra.save()
		self.assertEqual(flt(ra.gross_work_value), 170000)
		self.assertEqual(ra.items[1].variation_order, vo.name)

	def test_measurement_book_pull(self):
		from ra_bill.ra_bill.doctype.ra_bill.ra_bill import get_mb_quantities

		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300}],
		)
		mb = frappe.get_doc(
			{
				"doctype": "Measurement Book",
				"project": project,
				"boq": boq.name,
				"entries": [
					{"description": "Excavation", "nos": 2, "length": 10, "breadth": 5, "depth": 2},
					{"description": "Excavation", "nos": 1, "length": 10, "breadth": 5, "depth": 2},
				],
			}
		)
		mb.insert(ignore_permissions=True)
		# quantities: 2*10*5*2=200 and 1*10*5*2=100 -> total 300 for "Excavation"
		totals = get_mb_quantities(mb.name)
		self.assertEqual(flt(totals.get("Excavation")), 300)

	def test_invoice_generation_links_back(self):
		from ra_bill.demo import _ensure_item, _ensure_settings

		_ensure_item()
		_ensure_settings()
		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300}],
		)
		ra = self._ra(boq)
		ra.items[0].cumulative_qty = 400
		ra.save()
		ra.submit()
		si_name = make_invoice(ra.name)
		si = frappe.get_doc("Sales Invoice", si_name)
		self.assertEqual(flt(si.net_total), 120000)
		self.assertEqual(si.get("ra_bill"), ra.name)
		self.assertEqual(frappe.db.get_value("RA Bill", ra.name, "sales_invoice"), si_name)
