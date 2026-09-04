import frappe
from frappe.utils import flt


def sync_ra_bill_deductions(doc, method=None):
    """
    Synchronize RA Bill deduction display rows on Purchase Invoice.
    Only updates when Purchase Invoice is in DRAFT (docstatus == 0).
    Does NOT alter Purchase Invoice accounting, taxes, or grand_total.
    """
    if doc.docstatus != 0:
        return

    ra_bill_name = getattr(doc, "ra_bill", None)
    if not ra_bill_name:
        return

    ra_bill = frappe.get_doc("RA Bill", ra_bill_name)

    doc.set("ra_bill_deductions", [])
    total_deductions = 0.0

    for d in ra_bill.get("deductions", []):
        amt = flt(d.amount)
        doc.append(
            "ra_bill_deductions",
            {
                "deduction_type": d.deduction_type,
                "description": d.description,
                "method": d.method,
                "rate": flt(d.rate),
                "amount": amt,
                "cap_percentage": flt(d.cap_percentage),
                "account": d.account,
                "payment_entry": d.payment_entry,
            },
        )
        total_deductions += amt

    doc.ra_bill_total_deductions = total_deductions
    doc.ra_bill_net_payment = flt(doc.grand_total) - total_deductions
