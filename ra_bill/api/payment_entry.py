import frappe
import erpnext
from frappe.utils import flt

from erpnext.accounts.doctype.payment_entry.payment_entry import (
    get_exchange_rate,
    get_party_account,
)


@frappe.whitelist()
def get_reference_details(
    reference_doctype,
    reference_name,
    party_account_currency,
    party_type=None,
    party=None,
):
    # Custom handling for RAB Work Order
    if reference_doctype == "RAB Work Order":
        doc = frappe.get_doc("RAB Work Order", reference_name)

        company_currency = erpnext.get_company_currency(doc.company)

        exchange_rate = 1
        if party_account_currency != company_currency:
            exchange_rate = get_exchange_rate(
                party_account_currency,
                company_currency,
                frappe.utils.nowdate(),
            )

        account = get_party_account(
            "Supplier",
            doc.supplier,
            doc.company,
        )

        # Total advances already paid against this Work Order
        already_paid = frappe.db.sql(
            """
            SELECT COALESCE(SUM(per.allocated_amount), 0)
            FROM `tabPayment Entry Reference` per
            INNER JOIN `tabPayment Entry` pe
                ON pe.name = per.parent
            WHERE
                per.reference_doctype = 'RAB Work Order'
                AND per.reference_name = %s
                AND pe.docstatus = 1
            """,
            doc.name,
        )[0][0]

        outstanding = flt(doc.contract_value) - flt(already_paid)

        return {
            "total_amount": flt(doc.contract_value),
            "outstanding_amount": outstanding,
            "exchange_rate": flt(exchange_rate),
            "account": account,
        }

    # Fallback to ERPNext standard behavior for all other doctypes
    from erpnext.accounts.doctype.payment_entry.payment_entry import (
        get_reference_details as erpnext_get_reference_details,
    )

    return erpnext_get_reference_details(
        reference_doctype,
        reference_name,
        party_account_currency,
        party_type,
        party,
    )


@frappe.whitelist()
def get_payment_entry(
    dt,
    dn,
    party_amount=None,
    bank_account=None,
    bank_amount=None,
):
    from erpnext.accounts.doctype.payment_entry.payment_entry import (
        get_payment_entry as erpnext_get_payment_entry,
    )

    pe = erpnext_get_payment_entry(
        dt=dt,
        dn=dn,
        party_amount=party_amount,
        bank_account=bank_account,
        bank_amount=bank_amount,
    )

    if isinstance(pe, dict):
        pe = frappe.get_doc(pe)

    pe.apply_ra_bill_deductions()

    return pe