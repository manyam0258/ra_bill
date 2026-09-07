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


def _ensure_supplier():
	name = "RA Test Supplier"
	if not frappe.db.exists("Supplier", name):
		sg = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"
		frappe.get_doc(
			{
				"doctype": "Supplier",
				"supplier_name": name,
				"supplier_group": sg,
			}
		).insert(ignore_permissions=True)
	return name


class TestRABill(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = _company()
		cls.customer = _ensure_customer()

	def setUp(self):
		super().setUp()
		self.company = _company()
		ret_acc = self._ensure_test_account("Retention Payable Test", "Liability")
		tds_acc = self._ensure_test_account("TDS Payable Test", "Liability")
		cess_acc = self._ensure_test_account("Labour Cess Payable Test", "Liability")
		mob_acc = self._ensure_test_account("Mobilization Advance Test", "Asset")
		adv_acc = self._ensure_test_account("Advance Recovery Test", "Asset")

		frappe.reload_doctype("RA Bill Settings")
		frappe.db.set_single_value("RA Bill Settings", "retention_payable_account", ret_acc)
		frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", tds_acc)
		frappe.db.set_single_value("RA Bill Settings", "labour_cess_account", cess_acc)
		frappe.db.set_single_value("RA Bill Settings", "mobilization_advance_account", mob_acc)
		frappe.db.set_single_value("RA Bill Settings", "advance_recovery_account", adv_acc)
		frappe.clear_cache()

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

	def test_get_boq_items_auto_detects_previous_ra_bill(self):
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
		ra1.submit()

		# Call get_boq_items WITHOUT passing previous_ra_bill
		rows = get_boq_items(boq.name)
		self.assertEqual(flt(rows[0]["previous_qty"]), 400.0)
		self.assertEqual(flt(rows[1]["previous_qty"]), 100.0)
		self.assertEqual(flt(rows[0]["cumulative_qty"]), 400.0)
		self.assertEqual(flt(rows[1]["cumulative_qty"]), 100.0)

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

	def test_separate_regular_and_mobilization_advances(self):
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import (
			make_payment_entry,
			create_mobilization_payment_entry,
		)
		from ra_bill.ra_bill.doctype.ra_bill.ra_bill import get_advances

		supplier = _ensure_supplier()
		project = self._project(mob=2000)
		boq = self._boq(
			project,
			[{"description": "Work", "uom": "Unit", "boq_qty": 100, "rate": 100}],
			boq_type="Subcontractor",
			supplier=supplier,
			mobilization_advance_amount=2000,
			mobilization_recovery_percentage=20,
		)

		bank_acc = frappe.db.get_value("Account", {"company": self.company, "account_type": "Bank", "is_group": 0}, "name")
		payable_acc = frappe.db.get_value("Account", {"company": self.company, "account_type": "Payable", "is_group": 0}, "name")

		pe_reg = make_payment_entry(boq.name)
		self.assertEqual(pe_reg.is_mobilization_advance, 0)
		if bank_acc and payable_acc:
			pe_reg.paid_from = bank_acc
			pe_reg.paid_to = payable_acc
		pe_reg.source_exchange_rate = 1.0
		pe_reg.target_exchange_rate = 1.0
		pe_reg.reference_no = "REF-1"
		pe_reg.reference_date = frappe.utils.nowdate()
		pe_reg.insert(ignore_permissions=True)
		pe_reg.submit()

		pe_mob = create_mobilization_payment_entry(boq.name)
		self.assertEqual(pe_mob.is_mobilization_advance, 1)
		if bank_acc and payable_acc:
			pe_mob.paid_from = bank_acc
			pe_mob.paid_to = payable_acc
		pe_mob.source_exchange_rate = 1.0
		pe_mob.target_exchange_rate = 1.0
		pe_mob.reference_no = "REF-2"
		pe_mob.reference_date = frappe.utils.nowdate()
		pe_mob.insert(ignore_permissions=True)
		pe_mob.save()  # Verify saving works without errors
		pe_mob.submit()

		advances = get_advances(boq.name)
		adv_names = [a["payment_entry"] for a in advances]
		self.assertIn(pe_reg.name, adv_names)
		self.assertNotIn(pe_mob.name, adv_names)

		ra1 = self._ra(boq)
		ra1.items[0].cumulative_qty = 50  # billable value = 5,000
		ra1.save()

		mob_rows = [d for d in ra1.deductions if d.deduction_type == "Mobilization Recovery"]
		self.assertTrue(mob_rows)
		self.assertEqual(mob_rows[0].payment_entry, pe_mob.name)
		# 20% of 5,000 = 1,000; remaining mobilization advance = 2,000 -> recovers 1,000
		self.assertEqual(flt(ra1.mobilization_recovery_amount), 1000.0)
		ra1.submit()

		# Second bill: remaining mobilization balance is 1,000 (2,000 - 1,000 = 1,000)
		ra2 = self._ra(boq, ra1.name)
		ra2.items[0].cumulative_qty = 100  # additional 5,000 billable value
		ra2.save()
		self.assertEqual(flt(ra2.mobilization_recovery_amount), 1000.0)
		ra2.submit()

	def test_fully_billed_work_order_prevents_new_ra_bill(self):
		project = self._project()
		boq = self._boq(
			project,
			[{"description": "Work Item", "uom": "Unit", "boq_qty": 100, "rate": 100}],
		)
		ra1 = self._ra(boq)
		ra1.items[0].cumulative_qty = 100
		ra1.save()
		ra1.submit()

		# Test with previous_ra_bill explicitly passed
		with self.assertRaises(frappe.ValidationError) as cm:
			self._ra(boq, ra1.name)
		self.assertIn("already been fully billed", str(cm.exception))

		# Test creating a fresh RA Bill where previous_ra_bill is empty/None initially
		fresh_ra = frappe.get_doc({"doctype": "RA Bill", "project": project, "boq": boq.name})
		with self.assertRaises(frappe.ValidationError) as cm2:
			fresh_ra.insert(ignore_permissions=True)
		self.assertIn("already been fully billed", str(cm2.exception))

	def test_payment_entry_accounting_flow_with_deductions(self):
		from ra_bill.api.payment_entry import get_payment_entry
		from ra_bill.demo import _ensure_item, _ensure_settings

		_ensure_item()
		_ensure_settings()

		abbr = frappe.get_cached_value("Company", self.company, "abbr")
		ret_acc = self._ensure_test_account("Retention Payable Test", "Liability")
		tds_acc = self._ensure_test_account("TDS Payable Test", "Liability")
		cess_acc = self._ensure_test_account("Labour Cess Payable Test", "Liability")
		mob_acc = self._ensure_test_account("Mobilization Advance Test", "Asset")
		adv_acc = self._ensure_test_account("Advance Recovery Test", "Asset")

		frappe.db.set_single_value("RA Bill Settings", "retention_payable_account", ret_acc)
		frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", tds_acc)
		frappe.db.set_single_value("RA Bill Settings", "labour_cess_account", cess_acc)
		frappe.db.set_single_value("RA Bill Settings", "mobilization_advance_account", mob_acc)
		frappe.db.set_single_value("RA Bill Settings", "advance_recovery_account", adv_acc)
		frappe.clear_cache()

		supplier = _ensure_supplier()
		project = self._project()
		wo_doc = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"apply_gst": 1,
				"gst_percentage": 18,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 100}],
				"deductions": [
					{"deduction_type": "Retention", "method": "Percentage", "rate": 5, "account": ret_acc},
					{"deduction_type": "TDS", "method": "Percentage", "rate": 2, "account": tds_acc},
					{"deduction_type": "Labour Cess", "method": "Percentage", "rate": 1, "account": cess_acc},
					{"deduction_type": "Advance Recovery", "method": "Fixed Amount", "amount": 500, "account": adv_acc},
				],
			}
		)
		wo_doc.insert(ignore_permissions=True)
		wo_doc.submit()

		ra = self._ra(wo_doc)
		ra.items[0].cumulative_qty = 50  # 50% billed -> gross = 5,000
		ra.save()
		ra.submit()

		self.assertEqual(flt(ra.gross_work_value), 5000.0)
		cess_row = next((d for d in ra.deductions if d.deduction_type == "Labour Cess"), None)
		self.assertIsNotNone(cess_row)
		self.assertEqual(flt(cess_row.amount), 50.0)
		self.assertEqual(flt(ra.gst_amount), 909.0)
		self.assertEqual(flt(ra.total_invoice_value), 5959.0)
		self.assertEqual(flt(ra.total_deductions), 900.0)
		self.assertEqual(flt(ra.net_payable), 5059.0)

		pi_name = make_invoice(ra.name)
		pi = frappe.get_doc("Purchase Invoice", pi_name)
		self.assertEqual(flt(pi.grand_total), 5000.0)
		pi.submit()

		pe = get_payment_entry("Purchase Invoice", pi_name)

		bank_acc = frappe.db.get_value(
			"Account",
			{"company": self.company, "account_type": "Bank", "is_group": 0},
			"name",
		) or frappe.db.get_value(
			"Account",
			{"company": self.company, "account_type": "Cash", "is_group": 0},
			"name",
		)
		if bank_acc:
			pe.paid_from = bank_acc
		pe.reference_no = "REF-TEST-PAY"
		pe.reference_date = frappe.utils.nowdate()

		pe.save(ignore_permissions=True)

		self.assertEqual(pe.work_order, wo_doc.name)
		self.assertEqual(flt(pe.references[0].allocated_amount), 5000.0)
		wo_ref = next((r for r in pe.references if r.reference_doctype == "RAB Work Order"), None)
		self.assertIsNotNone(wo_ref)
		self.assertEqual(wo_ref.reference_name, wo_doc.name)
		self.assertEqual(flt(pe.paid_amount), 4100.0)
		self.assertEqual(flt(pe.difference_amount), 0.0)
		self.assertEqual(len(pe.deductions), 4)

		deductions_map = {d.account: flt(d.amount) for d in pe.deductions}
		self.assertEqual(deductions_map.get(ret_acc), 250.0)
		self.assertEqual(deductions_map.get(tds_acc), 100.0)
		self.assertEqual(deductions_map.get(cess_acc), 50.0)
		self.assertEqual(deductions_map.get(adv_acc), 500.0)

		pe.submit()

		gl_entries = frappe.get_all(
			"GL Entry",
			filters={"voucher_type": "Payment Entry", "voucher_no": pe.name},
			fields=["account", "debit", "credit"],
		)

		payable_acc = pe.paid_to
		gl_map = {}
		for gle in gl_entries:
			acc = gle.account
			gl_map[acc] = gl_map.get(acc, {"debit": 0.0, "credit": 0.0})
			gl_map[acc]["debit"] += flt(gle.debit)
			gl_map[acc]["credit"] += flt(gle.credit)

		self.assertEqual(gl_map[payable_acc]["debit"], 5000.0)
		self.assertEqual(gl_map[pe.paid_from]["credit"], 4100.0)
		self.assertEqual(gl_map[ret_acc]["credit"], 250.0)
		self.assertEqual(gl_map[tds_acc]["credit"], 100.0)
		self.assertEqual(gl_map[cess_acc]["credit"], 50.0)
		self.assertEqual(gl_map[adv_acc]["credit"], 500.0)

		total_debits = sum(g["debit"] for g in gl_map.values())
		total_credits = sum(g["credit"] for g in gl_map.values())
		self.assertEqual(total_debits, 5000.0)
		self.assertEqual(total_credits, 5000.0)

	def test_missing_deduction_account_throws_error(self):
		from ra_bill.api.payment_entry import get_payment_entry
		from ra_bill.demo import _ensure_item, _ensure_settings

		_ensure_item()
		_ensure_settings()

		orig_tds = frappe.db.get_single_value("RA Bill Settings", "tds_payable_account")
		try:
			frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", None)

			supplier = _ensure_supplier()
			project = self._project()
			wo_doc = frappe.get_doc(
				{
					"doctype": "RAB Work Order",
					"project": project,
					"boq_type": "Subcontractor",
					"supplier": supplier,
					"company": self.company,
					"apply_gst": 0,
					"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 50}],
					"deductions": [
						{"deduction_type": "TDS", "method": "Fixed Amount", "amount": 100},
					],
				}
			)
			wo_doc.insert(ignore_permissions=True)
			wo_doc.submit()

			ra = self._ra(wo_doc)
			ra.items[0].cumulative_qty = 100
			ra.save()
			ra.submit()

			pi_name = make_invoice(ra.name)
			pi = frappe.get_doc("Purchase Invoice", pi_name)
			pi.submit()

			with self.assertRaises(frappe.ValidationError) as cm:
				get_payment_entry("Purchase Invoice", pi_name)
			self.assertIn("TDS Payable Account is not configured in RA Bill Settings.", str(cm.exception))
		finally:
			frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", orig_tds)

	def _ensure_test_account(self, account_name, root_type="Asset", account_type=None):
		abbr = frappe.get_cached_value("Company", self.company, "abbr")
		full_name = f"{account_name} - {abbr}"
		if not frappe.db.exists("Account", full_name):
			if root_type in ["Current Assets", "Bank", "Cash", "Asset"]:
				real_root_type = "Asset"
			elif root_type in ["Current Liabilities", "Payable", "Liability"]:
				real_root_type = "Liability"
			else:
				real_root_type = root_type

			parent = (
				frappe.db.get_value("Account", {"company": self.company, "account_type": root_type, "is_group": 1}, "name")
				or frappe.db.get_value("Account", {"company": self.company, "account_name": ["like", f"%{root_type}%"], "is_group": 1}, "name")
				or frappe.db.get_value("Account", {"company": self.company, "root_type": real_root_type, "is_group": 1}, "name")
			)
			doc_dict = {
				"doctype": "Account",
				"account_name": account_name,
				"company": self.company,
				"parent_account": parent,
				"root_type": real_root_type,
				"is_group": 0,
			}
			if account_type:
				doc_dict["account_type"] = account_type
			frappe.get_doc(doc_dict).insert(ignore_permissions=True)
		return full_name

	def test_purchase_invoice_ra_bill_deductions_display(self):
		from ra_bill.demo import _ensure_item, _ensure_settings

		_ensure_item()
		_ensure_settings()

		supplier = _ensure_supplier()
		project = self._project()
		wo_doc = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 50}],
				"deductions": [
					{"deduction_type": "Retention", "method": "Percentage", "rate": 5},
					{"deduction_type": "TDS", "method": "Fixed Amount", "amount": 100},
					{"deduction_type": "Labour Cess", "method": "Fixed Amount", "amount": 50},
				],
			}
		)
		wo_doc.insert(ignore_permissions=True)
		wo_doc.submit()

		ra = self._ra(wo_doc)
		ra.items[0].cumulative_qty = 100
		ra.save()
		ra.submit()

		pi_name = make_invoice(ra.name)
		pi = frappe.get_doc("Purchase Invoice", pi_name)

		# Verify dynamic deduction rows copied to Purchase Invoice display table
		self.assertEqual(len(pi.ra_bill_deductions), 3)
		self.assertEqual(flt(pi.ra_bill_total_deductions), 400.0)  # 250 + 100 + 50
		self.assertEqual(flt(pi.ra_bill_net_payment), 4600.0)  # 5000 - 400
		self.assertEqual(flt(pi.grand_total), 5000.0)  # Accounting grand_total remains 5000!

		# Verify submitting locks the table snapshot
		pi.submit()
		self.assertEqual(pi.docstatus, 1)
		self.assertEqual(len(pi.ra_bill_deductions), 3)

	def test_mobilization_recovery_and_labour_cess_calculation(self):
		from ra_bill.demo import _ensure_item, _ensure_settings

		_ensure_item()
		_ensure_settings()

		supplier = _ensure_supplier()
		project = self._project()
		wo_doc = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 10000.0,
				"mobilization_advance_amount": 1000.0,
				"apply_gst": 1,
				"gst_percentage": 18,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 100}],
				"deductions": [
					{"deduction_type": "Retention", "method": "Percentage", "rate": 5},
					{"deduction_type": "TDS", "method": "Percentage", "rate": 2},
					{"deduction_type": "Labour Cess", "method": "Percentage", "rate": 1},
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20},
				],
			}
		)
		wo_doc.insert(ignore_permissions=True)
		wo_doc.submit()

		ra = self._ra(wo_doc)
		ra.items[0].cumulative_qty = 50  # Work value = 5,000
		ra.save()

		# 1. Mobilization Recovery (20%) must be calculated against Advance (1,000) -> 200, NOT against work value (5,000) -> 1,000
		mob_row = next((d for d in ra.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertIsNotNone(mob_row)
		self.assertEqual(flt(mob_row.amount), 200.0)

		# 2. Labour Cess (50) is included in GST calculation, but NOT added on top of total_invoice_value
		self.assertEqual(flt(ra.gross_work_value), 5000.0)
		self.assertEqual(flt(ra.gst_amount), 909.0)  # (5000 + 50) * 18%
		self.assertEqual(flt(ra.total_invoice_value), 5909.0)  # 5000 + 909 (NOT 5959)

		# 3. Total Deductions = Retention (250) + TDS (100) + Labour Cess (50) + Mob Recovery (200) = 600
		self.assertEqual(flt(ra.total_deductions), 600.0)
		self.assertEqual(flt(ra.net_payable), 5309.0)  # 5909 - 600

		ra.submit()

		pi_name = make_invoice(ra.name)
		pi = frappe.get_doc("Purchase Invoice", pi_name)
		self.assertEqual(flt(pi.grand_total), 5000.0)  # Standard Purchase Invoice item grand_total

	def test_mobilization_advance_lifecycle_scenarios(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		# Test 1: Work Order submitted with ₹0 advance
		wo_doc = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"mobilization_advance_amount": 0.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [
					{"deduction_type": "Retention", "method": "Percentage", "rate": 5},
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20},
				],
			}
		)
		wo_doc.insert(ignore_permissions=True)
		wo_doc.submit()
		self.assertEqual(wo_doc.docstatus, 1)

		# Test 6 (Part A): RA Bill 1 created before advance paid -> Recovery = ₹0
		ra1 = self._ra(wo_doc)
		ra1.items[0].cumulative_qty = 10  # 10,000 work value
		ra1.save()
		mob_row1 = next((d for d in ra1.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row1.amount), 0.0)
		ra1.submit()

		# Test 2: Create Mobilization Advance Payment Entry ₹10,000 after WO submission & submit it
		pe1 = create_mobilization_payment_entry(wo_doc.name, advance_amount=10000.0)
		pe1.insert(ignore_permissions=True)
		pe1.submit()
		self.assertEqual(pe1.docstatus, 1)
		self.assertEqual(pe1.is_mobilization_advance, 1)

		# Test 3 & Test 6 (Part B): Create RA Bill 2 after ₹10,000 advance -> Recovery 20% = ₹2,000
		ra2 = self._ra(wo_doc, previous=ra1.name)
		ra2.items[0].cumulative_qty = 20  # 10,000 work value
		ra2.save()
		mob_row2 = next((d for d in ra2.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row2.amount), 2000.0)
		ra2.submit()

		# Test 4: Check remaining advance balance after RA Bill 2 (10,000 - 2,000 = 8,000)
		bal = ra2.get_project_advance_balance()
		self.assertEqual(flt(bal), 8000.0)

		# Test 5: Create RA Bill 3 -> Recovery 20% = ₹2,000, remaining = ₹6,000
		ra3 = self._ra(wo_doc, previous=ra2.name)
		ra3.items[0].cumulative_qty = 30
		ra3.save()
		mob_row3 = next((d for d in ra3.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row3.amount), 2000.0)
		ra3.submit()

		bal3 = ra3.get_project_advance_balance()
		self.assertEqual(flt(bal3), 6000.0)

	def test_multiple_advances_and_capping(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		# Test 7: Multiple Advances (₹5,000 + ₹3,000 + ₹2,000 = ₹10,000)
		wo = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"mobilization_advance_amount": 0.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20},
				],
			}
		)
		wo.insert(ignore_permissions=True)
		wo.submit()

		pe1 = create_mobilization_payment_entry(wo.name, advance_amount=5000.0)
		pe1.insert(ignore_permissions=True); pe1.submit()

		pe2 = create_mobilization_payment_entry(wo.name, advance_amount=3000.0)
		pe2.insert(ignore_permissions=True); pe2.submit()

		pe3 = create_mobilization_payment_entry(wo.name, advance_amount=2000.0)
		pe3.insert(ignore_permissions=True); pe3.submit()

		ra = self._ra(wo)
		ra.items[0].cumulative_qty = 10
		ra.save()
		mob_row = next((d for d in ra.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row.amount), 2000.0)  # 20% of 10,000 = 2,000
		ra.submit()

		# Test 8: Recovery exceeding balance is blocked; corrected rate succeeds
		ra_cap = self._ra(wo, previous=ra.name)
		ra_cap._cumulative_mobilization_recovered = lambda *args, **kwargs: 9500.0
		# 20% of 10,000 = 2,000 > remaining 500 -> must raise ValidationError
		self.assertRaises(frappe.ValidationError, ra_cap.save)
		# Correct rate to 5% (5% of 10,000 = 500) -> succeeds with 500
		ra_cap.reload()
		ra_cap._cumulative_mobilization_recovered = lambda *args, **kwargs: 9500.0
		mob_row_cap = next((d for d in ra_cap.deductions if d.deduction_type == "Mobilization Recovery"), None)
		mob_row_cap.rate = 5.0
		ra_cap.save()
		self.assertEqual(flt(mob_row_cap.amount), 500.0)

	def test_cancelled_advance_exclusion(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		# Test 9: Cancelled advance Payment Entry is excluded
		wo = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20},
				],
			}
		)
		wo.insert(ignore_permissions=True)
		wo.submit()

		pe = create_mobilization_payment_entry(wo.name, advance_amount=10000.0)
		pe.insert(ignore_permissions=True); pe.submit()
		pe.cancel()

		ra = self._ra(wo)
		ra.items[0].cumulative_qty = 10
		ra.save()
		mob_row = next((d for d in ra.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row.amount), 0.0)  # Cancelled advance is NOT included

	def test_mobilization_advance_accounting_and_gl_entries(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		mob_acc = self._ensure_test_account("Mobilization Advance Asset Test", "Asset", "Current Asset")
		tds_acc = self._ensure_test_account("TDS Payable Test", "Liability")

		frappe.db.set_single_value("RA Bill Settings", "mobilization_advance_account", mob_acc)
		frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", tds_acc)

		wo = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"mobilization_advance_amount": 0.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [
					{"deduction_type": "TDS", "method": "Percentage", "rate": 2.0, "account": tds_acc},
					{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20.0},
				],
			}
		)
		wo.insert(ignore_permissions=True)
		wo.submit()

		# TEST 1: Create Gross ₹1,000 Advance Payment Entry (TDS auto-calculated from WO = 2% = ₹20)
		pe1 = create_mobilization_payment_entry(wo.name, advance_amount=1000.0)
		pe1.insert(ignore_permissions=True)
		pe1.submit()

		# Verify GL Entries for ₹1,000 Gross Advance + ₹20 TDS
		gl1 = frappe.db.get_all("GL Entry", filters={"voucher_no": pe1.name}, fields=["account", "debit", "credit"])
		mob_gl1 = next((g for g in gl1 if g.account == mob_acc), None)
		tds_gl1 = next((g for g in gl1 if g.account == tds_acc), None)
		bank_gl1 = next((g for g in gl1 if g.account == pe1.paid_from), None)

		self.assertIsNotNone(mob_gl1)
		self.assertEqual(flt(mob_gl1.debit), 1000.0)
		self.assertEqual(flt(mob_gl1.credit), 0.0)

		self.assertIsNotNone(tds_gl1)
		self.assertEqual(flt(tds_gl1.debit), 0.0)
		self.assertEqual(flt(tds_gl1.credit), 20.0)

		self.assertIsNotNone(bank_gl1)
		self.assertEqual(flt(bank_gl1.debit), 0.0)
		self.assertEqual(flt(bank_gl1.credit), 980.0)

		# TEST 3: Create Gross ₹5,000 Advance Payment Entry (TDS auto-calculated = ₹100)
		pe = create_mobilization_payment_entry(wo.name, advance_amount=5000.0)
		pe.insert(ignore_permissions=True)
		pe.submit()

		# Verify GL Entries generated for Gross Advance ₹5,000 with ₹100 TDS
		gl_entries = frappe.db.get_all("GL Entry", filters={"voucher_no": pe.name}, fields=["account", "debit", "credit"])
		mob_gl = next((g for g in gl_entries if g.account == mob_acc), None)
		tds_gl = next((g for g in gl_entries if g.account == tds_acc), None)
		bank_gl = next((g for g in gl_entries if g.account == pe.paid_from), None)

		self.assertIsNotNone(mob_gl)
		self.assertEqual(flt(mob_gl.debit), 5000.0)
		self.assertEqual(flt(mob_gl.credit), 0.0)

		self.assertIsNotNone(tds_gl)
		self.assertEqual(flt(tds_gl.debit), 0.0)
		self.assertEqual(flt(tds_gl.credit), 100.0)

		self.assertIsNotNone(bank_gl)
		self.assertEqual(flt(bank_gl.debit), 0.0)
		self.assertEqual(flt(bank_gl.credit), 4900.0)

		# TEST 4: Verify gross advances (1,000 + 5,000 = 6,000) are recognized for RA Bill recovery
		ra = self._ra(wo)
		ra.items[0].cumulative_qty = 10
		ra.save()

		gross_adv = ra.get_project_original_mobilization_advance()
		self.assertEqual(flt(gross_adv), 6000.0)

		mob_row = next((d for d in ra.deductions if d.deduction_type == "Mobilization Recovery"), None)
		self.assertEqual(flt(mob_row.amount), 1200.0)  # 20% of 6,000 = 1,200 (NOT based on 980 or 4,900)

	def test_mobilization_advance_no_tds(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		mob_acc = self._ensure_test_account("Mobilization Advance Asset Test", "Asset", "Current Asset")
		frappe.db.set_single_value("RA Bill Settings", "mobilization_advance_account", mob_acc)

		wo = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20}],
			}
		)
		wo.insert(ignore_permissions=True)
		wo.submit()

		# Gross Advance ₹5,000 without TDS
		pe = create_mobilization_payment_entry(wo.name, advance_amount=5000.0)
		pe.insert(ignore_permissions=True); pe.submit()

		gl_entries = frappe.db.get_all("GL Entry", filters={"voucher_no": pe.name}, fields=["account", "debit", "credit"])
		mob_gl = next((g for g in gl_entries if g.account == mob_acc), None)
		bank_gl = next((g for g in gl_entries if g.account == pe.paid_from), None)

		self.assertIsNotNone(mob_gl)
		self.assertEqual(flt(mob_gl.debit), 5000.0)
		self.assertEqual(flt(mob_gl.credit), 0.0)

		self.assertIsNotNone(bank_gl)
		self.assertEqual(flt(bank_gl.debit), 0.0)
		self.assertEqual(flt(bank_gl.credit), 5000.0)

	def test_mobilization_advance_different_tds(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_mobilization_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		mob_acc = self._ensure_test_account("Mobilization Advance Asset Test", "Asset", "Current Asset")
		tds_acc = self._ensure_test_account("TDS Payable Test", "Liability")

		frappe.db.set_single_value("RA Bill Settings", "mobilization_advance_account", mob_acc)
		frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", tds_acc)

		wo = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 100000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 100, "rate": 1000}],
				"deductions": [{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": 20}],
			}
		)
		wo.insert(ignore_permissions=True)
		wo.submit()

		# Gross Advance ₹10,000 with ₹200 TDS
		pe = create_mobilization_payment_entry(wo.name, advance_amount=10000.0)
		pe.append(
			"deductions",
			{
				"account": tds_acc,
				"cost_center": pe.cost_center or frappe.get_cached_value("Company", pe.company, "cost_center"),
				"amount": 200.0,
				"description": "TDS Deduction on Mobilization Advance",
			},
		)
		pe.insert(ignore_permissions=True); pe.submit()

		gl_entries = frappe.db.get_all("GL Entry", filters={"voucher_no": pe.name}, fields=["account", "debit", "credit"])
		mob_gl = next((g for g in gl_entries if g.account == mob_acc), None)
		tds_gl = next((g for g in gl_entries if g.account == tds_acc), None)
		bank_gl = next((g for g in gl_entries if g.account == pe.paid_from), None)

		self.assertIsNotNone(mob_gl)
		self.assertEqual(flt(mob_gl.debit), 10000.0)

		self.assertIsNotNone(tds_gl)
		self.assertEqual(flt(tds_gl.credit), 200.0)

		self.assertIsNotNone(bank_gl)
		self.assertEqual(flt(bank_gl.credit), 9800.0)

	def test_adhoc_advance_dynamic_tds_rates(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_adhoc_payment_entry

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()

		adv_acc = self._ensure_test_account("Adhoc Advance Asset Test", "Asset", "Current Asset")
		tds_acc = self._ensure_test_account("TDS Payable Test", "Liability")

		frappe.db.set_single_value("RA Bill Settings", "advance_recovery_account", adv_acc)
		frappe.db.set_single_value("RA Bill Settings", "tds_payable_account", tds_acc)

		# Scenario A: ₹1,000 Ad Hoc Advance, TDS 0% (Contract Value = ₹10,000)
		wo_0 = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 10000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 10, "rate": 1000}],
			}
		)
		wo_0.insert(ignore_permissions=True)
		tds_row0 = next((d for d in wo_0.deductions if d.deduction_type == "TDS"), None)
		if tds_row0:
			tds_row0.rate = 0.0
			tds_row0.account = tds_acc
		wo_0.save(ignore_permissions=True); wo_0.submit()

		pe0 = create_adhoc_payment_entry(wo_0.name, advance_amount=1000.0)
		self.assertEqual(len(pe0.deductions), 0)
		self.assertEqual(flt(pe0.paid_amount), 1000.0)
		self.assertEqual(flt(pe0.references[0].allocated_amount), 1000.0)
		self.assertEqual(flt(pe0.unallocated_amount), 0.0)

		pe0.insert(ignore_permissions=True); pe0.submit()

		gl0 = frappe.db.get_all("GL Entry", filters={"voucher_no": pe0.name}, fields=["account", "debit", "credit"])
		adv_gl0 = next((g for g in gl0 if g.account == adv_acc), None)
		bank_gl0 = next((g for g in gl0 if g.account == pe0.paid_from), None)
		tds_gl0 = next((g for g in gl0 if g.account == tds_acc), None)

		self.assertIsNotNone(adv_gl0)
		self.assertEqual(flt(adv_gl0.debit), 1000.0)
		self.assertEqual(flt(bank_gl0.credit), 1000.0)
		self.assertIsNone(tds_gl0)

		# Scenario B: ₹1,000 Ad Hoc Advance, TDS 2% (Contract Value = ₹10,000)
		wo_2 = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 10000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 10, "rate": 1000}],
			}
		)
		wo_2.insert(ignore_permissions=True)
		tds_row2 = next((d for d in wo_2.deductions if d.deduction_type == "TDS"), None)
		if tds_row2:
			tds_row2.rate = 2.0
			tds_row2.account = tds_acc
		wo_2.save(ignore_permissions=True); wo_2.submit()

		pe2 = create_adhoc_payment_entry(wo_2.name, advance_amount=1000.0)
		self.assertEqual(len(pe2.deductions), 1)
		self.assertEqual(pe2.deductions[0].account, tds_acc)
		self.assertEqual(flt(pe2.deductions[0].amount), 20.0)
		self.assertEqual(flt(pe2.paid_amount), 1000.0)
		self.assertEqual(flt(pe2.references[0].allocated_amount), 1000.0)
		self.assertEqual(flt(pe2.unallocated_amount), 0.0)

		pe2.insert(ignore_permissions=True)

		# Verify save and reload persistence
		pe2_reloaded = frappe.get_doc("Payment Entry", pe2.name)
		self.assertEqual(len(pe2_reloaded.deductions), 1)
		self.assertEqual(pe2_reloaded.deductions[0].account, tds_acc)
		self.assertEqual(flt(pe2_reloaded.deductions[0].amount), 20.0)

		pe2_reloaded.save(ignore_permissions=True)

		pe2_reloaded2 = frappe.get_doc("Payment Entry", pe2.name)
		self.assertEqual(len(pe2_reloaded2.deductions), 1)
		self.assertEqual(pe2_reloaded2.deductions[0].account, tds_acc)
		self.assertEqual(flt(pe2_reloaded2.deductions[0].amount), 20.0)

		pe2_reloaded2.submit()

		gl2 = frappe.db.get_all("GL Entry", filters={"voucher_no": pe2.name}, fields=["account", "debit", "credit"])
		adv_gl2 = next((g for g in gl2 if g.account == adv_acc), None)
		tds_gl2 = next((g for g in gl2 if g.account == tds_acc), None)
		bank_gl2 = next((g for g in gl2 if g.account == pe2.paid_from), None)

		self.assertEqual(flt(adv_gl2.debit), 1000.0)
		self.assertEqual(flt(tds_gl2.credit), 20.0)
		self.assertEqual(flt(bank_gl2.credit), 980.0)

		# Scenario C: ₹1,000 Ad Hoc Advance, TDS 5% (Contract Value = ₹10,000)
		wo_5 = frappe.get_doc(
			{
				"doctype": "RAB Work Order",
				"project": project,
				"boq_type": "Subcontractor",
				"supplier": supplier,
				"company": self.company,
				"contract_value": 10000.0,
				"apply_gst": 0,
				"items": [{"description": "Civil Work", "uom": "Unit", "boq_qty": 10, "rate": 1000}],
			}
		)
		wo_5.insert(ignore_permissions=True)
		tds_row5 = next((d for d in wo_5.deductions if d.deduction_type == "TDS"), None)
		if tds_row5:
			tds_row5.rate = 5.0
			tds_row5.account = tds_acc
		wo_5.save(ignore_permissions=True); wo_5.submit()

		pe5 = create_adhoc_payment_entry(wo_5.name, advance_amount=1000.0)
		self.assertEqual(len(pe5.deductions), 1)
		self.assertEqual(pe5.deductions[0].account, tds_acc)
		self.assertEqual(flt(pe5.deductions[0].amount), 50.0)
		self.assertEqual(flt(pe5.paid_amount), 1000.0)
		self.assertEqual(flt(pe5.references[0].allocated_amount), 1000.0)
		self.assertEqual(flt(pe5.unallocated_amount), 0.0)

		pe5.insert(ignore_permissions=True); pe5.submit()

		gl5 = frappe.db.get_all("GL Entry", filters={"voucher_no": pe5.name}, fields=["account", "debit", "credit"])
		adv_gl5 = next((g for g in gl5 if g.account == adv_acc), None)
		tds_gl5 = next((g for g in gl5 if g.account == tds_acc), None)
		bank_gl5 = next((g for g in gl5 if g.account == pe5.paid_from), None)

		self.assertEqual(flt(adv_gl5.debit), 1000.0)
		self.assertEqual(flt(tds_gl5.credit), 50.0)
		self.assertEqual(flt(bank_gl5.credit), 950.0)
		self.assertEqual(sum(flt(g.debit) for g in gl5), sum(flt(g.credit) for g in gl5))

	def test_rab_work_order_ledger_report(self):
		from ra_bill.demo import _ensure_item, _ensure_settings
		from ra_bill.ra_bill.doctype.rab_work_order.rab_work_order import create_adhoc_payment_entry
		from ra_bill.ra_bill.report.rab_work_order_ledger.rab_work_order_ledger import execute
		from ra_bill.ra_bill.doctype.ra_bill.ra_bill import make_invoice

		_ensure_item()
		_ensure_settings()
		supplier = _ensure_supplier()
		project = self._project()
		boq = self._boq(project, [{"description": "Civil Work", "uom": "Unit", "boq_qty": 10, "rate": 1000}], boq_type="Subcontractor", supplier=supplier)

		# 1. Create & submit Ad Hoc Payment Entry
		pe = create_adhoc_payment_entry(boq.name, advance_amount=1000.0)
		pe.insert(ignore_permissions=True); pe.submit()

		# 2. Create & submit RA Bill + Purchase Invoice
		ra = self._ra(boq)
		ra.items[0].cumulative_qty = 5.0
		ra.save(ignore_permissions=True); ra.submit()

		pi_name = make_invoice(ra.name)
		pi_doc = frappe.get_doc("Purchase Invoice", pi_name)
		pi_doc.submit()

		# Execute report
		res = execute({"rab_work_order": boq.name})
		columns, data, message, chart, report_summary = res

		self.assertTrue(len(columns) == 6)
		self.assertTrue(len(data) > 0)

		pi_rows = [r for r in data if r["source_doctype"] == "Purchase Invoice"]
		pe_rows = [r for r in data if r["source_doctype"] == "Payment Entry"]

		self.assertTrue(len(pi_rows) > 0)
		self.assertTrue(len(pe_rows) > 0)

		for r in data:
			if not r.get("is_header"):
				self.assertEqual(r["voucher_no"], boq.name)
				self.assertIn(r["source_voucher"], (pi_name, pe.name))

		headers = [r["account"] for r in data if r.get("is_header")]
		self.assertTrue(len(headers) >= 2)

		# Verify summary metrics
		self.assertTrue(len(report_summary) >= 8)
		contract_card = next((s for s in report_summary if s["label"] == "Contract Value"), None)
		self.assertIsNotNone(contract_card)
		self.assertEqual(flt(contract_card["value"]), 10000.0)


def run_payment_entry_tests():
	t = TestRABill()
	t.setUpClass()
	t.setUp()
	t.test_payment_entry_accounting_flow_with_deductions()
	print("✓ test_payment_entry_accounting_flow_with_deductions PASSED")
	t.setUp()
	t.test_missing_deduction_account_throws_error()
	print("✓ test_missing_deduction_account_throws_error PASSED")




