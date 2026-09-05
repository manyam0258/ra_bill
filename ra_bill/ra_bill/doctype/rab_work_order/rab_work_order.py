# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

# Standard additions/deductions seeded onto a new Work Order. Each RA Bill carries
# these rows forward and computes the actual amount on its billable value.
DEFAULT_ADDITIONS = [
	{"addition_type": "Escalation", "method": "Percentage", "rate": 0.0},
	{"addition_type": "Secured Advance", "method": "Percentage", "rate": 0.0},
]
DEDUCTION_DESCRIPTION_MAP = {
	"Retention": "Retention on Gross Work Value",
	"TDS": "TDS on Gross Work Value",
	"Labour Cess": "Labour Cess on Gross Work Value",
	"Mobilization Recovery": "Mobilization Recovery on Advance Amount",
}

DEFAULT_DEDUCTIONS = [
	{"deduction_type": "Retention", "description": "Retention on Gross Work Value", "method": "Percentage", "rate": 5.0, "cap_percentage": 5.0},
	{"deduction_type": "TDS", "description": "TDS on Gross Work Value", "method": "Percentage", "rate": 2.0},
	{"deduction_type": "Labour Cess", "description": "Labour Cess on Gross Work Value", "method": "Percentage", "rate": 1.0},
	{"deduction_type": "Mobilization Recovery", "description": "Mobilization Recovery on Advance Amount", "method": "Percentage", "rate": 20.0},
]


class RABWorkOrder(Document):
	def validate(self):
		if self.project and not frappe.db.exists("Project", self.project):
			real_proj = frappe.db.get_value("Project", {"project_name": self.project}, "name") or frappe.db.get_value("Project", {"title": self.project}, "name")
			if real_proj:
				self.project = real_proj
		self.calculate_totals()
		if not self.contract_value:
			self.contract_value = self.total_boq_amount
		for row in self.deductions:
			if row.deduction_type in DEDUCTION_DESCRIPTION_MAP:
				row.description = DEDUCTION_DESCRIPTION_MAP[row.deduction_type]

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
@frappe.whitelist()
@frappe.whitelist()
def make_payment_entry(work_order):
    doc = frappe.get_doc("RAB Work Order", work_order)

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.party_type = "Supplier"
    pe.party = doc.supplier
    supplier = frappe.get_cached_doc("Supplier", doc.supplier)
    pe.party_name = supplier.supplier_name
    pe.company = doc.company
    pe.posting_date = frappe.utils.nowdate()
    pe.is_mobilization_advance = 0

    pe.paid_amount = flt(doc.contract_value)
    pe.received_amount = flt(doc.contract_value)

    pe.append("references", {
        "reference_doctype": "RAB Work Order",
        "reference_name": doc.name,
        "total_amount": flt(doc.contract_value),
        "outstanding_amount": flt(doc.contract_value),
        "allocated_amount": flt(doc.contract_value),
        "exchange_rate": 1,
    })

    return pe

def get_rab_work_order_allocated_amount(work_order, exclude_pe=None):
    query = """
        SELECT COALESCE(SUM(per.allocated_amount), 0.0)
        FROM `tabPayment Entry Reference` per
        INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
        WHERE pe.docstatus = 1
          AND per.reference_doctype = 'RAB Work Order'
          AND per.reference_name = %s
    """
    params = [work_order]
    if exclude_pe:
        query += " AND pe.name != %s"
        params.append(exclude_pe)

    rows = frappe.db.sql(query, tuple(params))
    return flt(rows[0][0]) if rows else 0.0

@frappe.whitelist()
def create_adhoc_payment_entry(work_order, advance_amount=None):
    doc = frappe.get_doc("RAB Work Order", work_order)

    contract_value = flt(doc.contract_value)
    already_allocated = get_rab_work_order_allocated_amount(work_order)
    current_outstanding = max(0.0, contract_value - already_allocated)

    if current_outstanding <= 0:
        frappe.throw(_("RAB Work Order {0} is already fully paid. Outstanding amount is 0.").format(work_order))

    amount = flt(advance_amount) if advance_amount is not None else 0.0
    if amount <= 0:
        frappe.throw(_("Please enter a valid Ad Hoc Advance Amount."))

    if amount > current_outstanding:
        frappe.throw(
            _("Ad Hoc Advance Amount ({0}) cannot exceed the remaining outstanding amount ({1}) for RAB Work Order {2}.").format(
                frappe.format_value(amount, {"fieldtype": "Currency"}),
                frappe.format_value(current_outstanding, {"fieldtype": "Currency"}),
                work_order,
            )
        )

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.party_type = "Supplier"
    pe.party = doc.supplier
    supplier = frappe.get_cached_doc("Supplier", doc.supplier)
    pe.party_name = supplier.supplier_name
    pe.company = doc.company
    pe.posting_date = frappe.utils.nowdate()
    pe.is_mobilization_advance = 0
    pe.is_adhoc_advance = 1
    pe.reference_no = "ADV-" + frappe.generate_hash(length=6)
    pe.reference_date = frappe.utils.nowdate()

    pe.paid_amount = amount
    pe.received_amount = amount
    pe.source_exchange_rate = 1.0
    pe.target_exchange_rate = 1.0

    company_currency = frappe.get_cached_value("Company", doc.company, "default_currency") or "INR"

    bank_acc = (
        frappe.db.get_value("Account", {"company": doc.company, "account_type": "Bank", "is_group": 0}, "name")
        or frappe.db.get_value("Account", {"company": doc.company, "account_type": "Cash", "is_group": 0}, "name")
    )
    payable_acc = (
        frappe.db.get_value("Account", {"company": doc.company, "account_type": "Payable", "is_group": 0}, "name")
        or frappe.db.get_value("Account", {"company": doc.company, "account_name": ["like", "%Creditor%"], "is_group": 0}, "name")
    )

    if bank_acc:
        pe.paid_from = bank_acc
        pe.paid_from_account_currency = (
            frappe.db.get_value("Account", bank_acc, "account_currency") or company_currency
        )
    if payable_acc:
        pe.paid_to = payable_acc
        pe.party_account = payable_acc
        pe.paid_to_account_currency = (
            frappe.db.get_value("Account", payable_acc, "account_currency") or company_currency
        )

    pe.append("references", {
        "reference_doctype": "RAB Work Order",
        "reference_name": doc.name,
        "total_amount": contract_value,
        "outstanding_amount": current_outstanding,
        "allocated_amount": amount,
        "exchange_rate": 1,
    })

    pe.set_missing_values()
    return pe

@frappe.whitelist()
def create_mobilization_payment_entry(work_order, advance_amount=None):
    doc = frappe.get_doc("RAB Work Order", work_order)

    amount = flt(advance_amount) if advance_amount is not None else flt(doc.mobilization_advance_amount)

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.party_type = "Supplier"
    pe.party = doc.supplier
    supplier = frappe.get_cached_doc("Supplier", doc.supplier)
    pe.party_name = supplier.supplier_name
    pe.company = doc.company
    pe.posting_date = frappe.utils.nowdate()
    pe.is_mobilization_advance = 1
    pe.reference_no = "MOB-ADV-" + frappe.generate_hash(length=6)
    pe.reference_date = frappe.utils.nowdate()

    pe.paid_amount = amount
    pe.received_amount = amount
    pe.source_exchange_rate = 1.0
    pe.target_exchange_rate = 1.0

    company_currency = frappe.get_cached_value("Company", doc.company, "default_currency") or "INR"

    bank_acc = (
        frappe.db.get_value("Account", {"company": doc.company, "account_type": "Bank", "is_group": 0}, "name")
        or frappe.db.get_value("Account", {"company": doc.company, "account_type": "Cash", "is_group": 0}, "name")
    )
    payable_acc = (
        frappe.db.get_value("Account", {"company": doc.company, "account_type": "Payable", "is_group": 0}, "name")
        or frappe.db.get_value("Account", {"company": doc.company, "account_name": ["like", "%Creditor%"], "is_group": 0}, "name")
    )
    mob_acc = frappe.db.get_single_value("RA Bill Settings", "mobilization_advance_account")
    if mob_acc and doc.company:
        acc_company = frappe.db.get_value("Account", mob_acc, "company")
        if acc_company and acc_company != doc.company:
            acc_name = frappe.db.get_value("Account", mob_acc, "account_name")
            matched_acc = frappe.db.get_value("Account", {"account_name": acc_name, "company": doc.company}, "name")
            if matched_acc:
                mob_acc = matched_acc

    target_acc = mob_acc or payable_acc

    if bank_acc:
        pe.paid_from = bank_acc
        pe.paid_from_account_currency = (
            frappe.db.get_value("Account", bank_acc, "account_currency") or company_currency
        )
    if payable_acc:
        pe.paid_to = payable_acc
        pe.party_account = payable_acc
        pe.paid_to_account_currency = (
            frappe.db.get_value("Account", payable_acc, "account_currency") or company_currency
        )

    pe.append("references", {
        "reference_doctype": "RAB Work Order",
        "reference_name": doc.name,
        "total_amount": amount,
        "outstanding_amount": amount,
        "allocated_amount": amount,
        "exchange_rate": 1,
    })

    # Auto-populate TDS deduction from RAB Work Order's deductions child table if configured
    tds_row = next((d for d in doc.get("deductions", []) if d.deduction_type == "TDS"), None)
    if tds_row and flt(tds_row.rate) > 0 and amount > 0:
        tds_rate = flt(tds_row.rate)
        tds_amount = flt(amount) * tds_rate / 100.0

        tds_account = getattr(tds_row, "account", None)
        if not tds_account:
            tds_account = frappe.db.get_single_value("RA Bill Settings", "tds_payable_account")
        if tds_account and doc.company:
            acc_company = frappe.db.get_value("Account", tds_account, "company")
            if acc_company and acc_company != doc.company:
                acc_name = frappe.db.get_value("Account", tds_account, "account_name")
                matched_acc = frappe.db.get_value("Account", {"account_name": acc_name, "company": doc.company}, "name")
                if matched_acc:
                    tds_account = matched_acc

        if tds_account and tds_amount > 0:
            pe.append(
                "deductions",
                {
                    "account": tds_account,
                    "cost_center": pe.cost_center or frappe.get_cached_value("Company", doc.company, "cost_center"),
                    "amount": tds_amount,
                    "description": f"TDS ({tds_rate}%) on Mobilization Advance",
                },
            )

    pe.set_missing_values()
    return pe