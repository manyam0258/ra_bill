import frappe
from frappe import _
from frappe.utils import flt, cint

from erpnext.accounts.doctype.payment_entry.payment_entry import (
    PaymentEntry,
)


def get_deduction_account(deduction_type, row_account=None, company=None):
    if row_account:
        return row_account

    mapping = {
        "Retention": ("retention_payable_account", "Retention Payable Account"),
        "TDS": ("tds_payable_account", "TDS Payable Account"),
        "Labour Cess": ("labour_cess_account", "Labour Cess Account"),
        "Mobilization Recovery": (
            "mobilization_advance_account",
            "Mobilization Advance Account",
        ),
    }

    if deduction_type in mapping:
        fieldname, label = mapping[deduction_type]
    else:
        fieldname, label = "advance_recovery_account", "Advance Recovery Account"

    account = frappe.db.get_single_value("RA Bill Settings", fieldname)

    if account and company:
        acc_company = frappe.db.get_value("Account", account, "company")
        if acc_company and acc_company != company:
            acc_name = frappe.db.get_value("Account", account, "account_name")
            matched_acc = frappe.db.get_value("Account", {"account_name": acc_name, "company": company}, "name")
            if matched_acc:
                account = matched_acc

    if not account:
        frappe.throw(_("{0} is not configured in RA Bill Settings.").format(label))

    return account


class CustomPaymentEntry(PaymentEntry):

    def get_valid_reference_doctypes(self):
        if self.party_type == "Customer":
            return (
                "Sales Order",
                "Sales Invoice",
                "Journal Entry",
                "Dunning",
                "Payment Entry",
            )

        elif self.party_type in ["Shareholder", "Employee"]:
            return ("Journal Entry",)

        elif self.party_type == "Supplier":
            return (
                "Purchase Order",
                "Purchase Invoice",
                "Journal Entry",
                "Payment Entry",
            )

    def set_missing_values(self):
        super().set_missing_values()
        self.apply_ra_bill_deductions()
        self.set_amounts()
        self.set_difference_amount()

    def set_missing_ref_details(self, force=False):
        super().set_missing_ref_details(force)

        for ref in self.references:
            if (
                ref.reference_doctype == "RAB Work Order"
                and ref.reference_name
            ):
                work_order = frappe.get_doc(
                    "RAB Work Order",
                    ref.reference_name,
                )

                if getattr(self, "is_mobilization_advance", 0):
                    ref.total_amount = flt(self.paid_amount) or flt(work_order.mobilization_advance_amount)
                else:
                    ref.total_amount = flt(work_order.contract_value)

                if not ref.exchange_rate:
                    ref.exchange_rate = 1

        self.apply_ra_bill_deductions()

    def validate(self):
        super().validate()
        self.apply_ra_bill_deductions()

    def is_adhoc_payment(self):
        if cint(getattr(self, "is_adhoc_advance", 0)):
            return True
        if (
            self.payment_type == "Pay"
            and getattr(self, "work_order", None)
            and not any(r.reference_doctype == "Purchase Invoice" for r in self.references)
            and not cint(getattr(self, "is_mobilization_advance", 0))
        ):
            return True
        if (
            self.payment_type == "Pay"
            and any(r.reference_doctype == "RAB Work Order" for r in self.references)
            and not any(r.reference_doctype == "Purchase Invoice" for r in self.references)
            and not cint(getattr(self, "is_mobilization_advance", 0))
        ):
            return True
        return False

    def apply_ra_bill_deductions(self):
        if self.payment_type != "Pay" or self.party_type != "Supplier":
            return

        if cint(getattr(self, "is_mobilization_advance", 0)) or self.is_adhoc_payment():
            self.apply_advance_tds_deductions()
            return

        has_ra_bill_pi = False
        self.set("deductions", [])
        total_deduction_amount = 0.0

        for ref in list(self.references):
            if ref.reference_doctype == "Purchase Invoice" and ref.reference_name:
                ra_bill_name = frappe.db.get_value(
                    "Purchase Invoice", ref.reference_name, "ra_bill"
                )
                if not ra_bill_name:
                    continue

                ra_bill = frappe.get_doc("RA Bill", ra_bill_name)
                has_ra_bill_pi = True

                # Automatically set top-level Work Order field
                if ra_bill.boq and not self.work_order:
                    self.work_order = ra_bill.boq

                # Ensure RAB Work Order references are not present
                self.references = [r for r in self.references if r.reference_doctype != "RAB Work Order"]

                # On subsequent PEs (e.g. paying hold), deductions were already deducted on first PE
                existing_pe_count = frappe.db.count(
                    "Payment Entry Reference",
                    {
                        "reference_doctype": "Purchase Invoice",
                        "reference_name": ref.reference_name,
                        "docstatus": 1,
                    },
                )
                if existing_pe_count > 0:
                    continue

                if not ra_bill.deductions:
                    continue

                for d in ra_bill.deductions:
                    amt = flt(d.amount)
                    if amt <= 0:
                        continue

                    account = get_deduction_account(d.deduction_type, d.account, company=self.company)
                    desc = f"{d.deduction_type} Deduction ({ra_bill.name})"
                    total_deduction_amount += amt

                    cost_center = (
                        ra_bill.cost_center
                        or self.cost_center
                        or frappe.get_cached_value("Company", self.company, "cost_center")
                    )

                    self.append(
                        "deductions",
                        {
                            "account": account,
                            "cost_center": cost_center,
                            "amount": amt,
                            "description": desc,
                        },
                    )

        if has_ra_bill_pi:
            self.references = [r for r in self.references if r.reference_doctype != "RAB Work Order"]
            total_allocated = sum(
                flt(r.allocated_amount or r.total_amount or r.outstanding_amount)
                for r in self.references
                if r.reference_doctype == "Purchase Invoice"
            )
            if total_allocated:
                net_cash = max(0.0, total_allocated - total_deduction_amount)
                self.paid_amount = net_cash
                self.received_amount = net_cash
            self.set_amounts()
            self.set_difference_amount()

    def apply_advance_tds_deductions(self):
        wo_name = self.work_order or next(
            (r.reference_name for r in self.references if r.reference_doctype == "RAB Work Order"),
            None,
        )
        if not wo_name:
            return

        wo = frappe.get_doc("RAB Work Order", wo_name)
        tds_row = next((d for d in wo.get("deductions", []) if d.deduction_type == "TDS"), None)
        if not tds_row or flt(tds_row.rate) <= 0 or flt(self.paid_amount) <= 0:
            self.set("deductions", [])
            return

        tds_rate = flt(tds_row.rate)
        tds_amount = flt(self.paid_amount) * tds_rate / 100.0

        tds_account = getattr(tds_row, "account", None)
        if not tds_account:
            tds_account = frappe.db.get_single_value("RA Bill Settings", "tds_payable_account")
        if tds_account and self.company:
            acc_company = frappe.db.get_value("Account", tds_account, "company")
            if acc_company and acc_company != self.company:
                acc_name = frappe.db.get_value("Account", tds_account, "account_name")
                matched_acc = frappe.db.get_value("Account", {"account_name": acc_name, "company": self.company}, "name")
                if matched_acc:
                    tds_account = matched_acc

        if not tds_account:
            self.set("deductions", [])
            return

        has_tds = False
        for d in list(self.get("deductions", [])):
            if d.account == tds_account:
                d.amount = tds_amount
                d.description = f"TDS ({tds_rate}%) on Advance"
                has_tds = True
            else:
                self.get("deductions").remove(d)

        if not has_tds and tds_amount > 0:
            self.append(
                "deductions",
                {
                    "account": tds_account,
                    "cost_center": self.cost_center or frappe.get_cached_value("Company", self.company, "cost_center"),
                    "amount": tds_amount,
                    "description": f"TDS ({tds_rate}%) on Advance",
                },
            )

    def set_difference_amount(self):
        super().set_difference_amount()
        if cint(getattr(self, "is_mobilization_advance", 0)) or self.is_adhoc_payment():
            self.difference_amount = 0.0
            return
        if self.payment_type == "Pay" and self.deductions:
            total_deductions = sum(flt(d.amount) for d in self.get("deductions"))
            base_party_amount = sum(
                flt(ref.allocated_amount) * flt(ref.exchange_rate or 1)
                for ref in self.references
            )
            included_taxes = self.get_included_taxes()
            self.difference_amount = flt(
                self.base_paid_amount + total_deductions - base_party_amount - included_taxes,
                self.precision("difference_amount"),
            )

    def validate_allocated_amount(self):
        """
        Skip ERPNext outstanding validation for RAB Work Orders.
        """
        self.references = [r for r in self.references if r.reference_doctype != "RAB Work Order"]
        super().validate_allocated_amount()

    def clear_unallocated_reference_document_rows(self):
        """
        Standard ERPNext behavior, ensuring no RAB Work Order reference rows remain.
        """
        super().clear_unallocated_reference_document_rows()
        self.references = [r for r in self.references if r.reference_doctype != "RAB Work Order"]

    def add_deductions_gl_entries(self, gl_entries):
        for d in self.get("deductions"):
            if not d.amount:
                continue

            account_currency = frappe.get_cached_value("Account", d.account, "account_currency") or self.company_currency
            if account_currency != self.company_currency:
                frappe.throw(_("Currency for {0} must be {1}").format(d.account, self.company_currency))

            # For Supplier payments with RA Bill deductions (Retention, TDS, Labour Cess, Mob Recovery, Advance Recovery),
            # deductions are withholdings/recoveries and must be CREDITED to balance the Gross Supplier Invoice Debit.
            if self.payment_type == "Pay" and self.party_type == "Supplier":
                dr_or_cr = "credit"
            else:
                dr_or_cr = "debit"

            exch_rate = flt(getattr(self, "target_exchange_rate", 1.0)) or 1.0
            gl_entries.append(
                self.get_gl_dict(
                    {
                        "account": d.account,
                        "account_currency": account_currency,
                        "against": self.party or self.paid_from,
                        dr_or_cr + "_in_account_currency": d.amount,
                        dr_or_cr + "_in_transaction_currency": d.amount / exch_rate,
                        dr_or_cr: d.amount,
                        "cost_center": d.cost_center,
                    },
                    item=d,
                )
            )

    def make_gl_entries(self, cancel=0, adv_adj=0):
        is_mob = getattr(self, "is_mobilization_advance", 0)
        is_adhoc = getattr(self, "is_adhoc_advance", 0) or (
            self.payment_type == "Pay"
            and (getattr(self, "work_order", None) or any(r.reference_doctype == "RAB Work Order" for r in self.references))
            and not any(r.reference_doctype == "Purchase Invoice" for r in self.references)
            and not is_mob
        )

        if not is_mob and not is_adhoc:
            super().make_gl_entries(cancel=cancel, adv_adj=adv_adj)
            return

        if is_mob:
            advance_acc = frappe.db.get_single_value("RA Bill Settings", "mobilization_advance_account")
        else:
            advance_acc = (
                frappe.db.get_single_value("RA Bill Settings", "advance_recovery_account")
                or frappe.db.get_value(
                    "Account",
                    {"account_name": ["like", "Advance%"], "company": self.company, "root_type": "Asset", "is_group": 0},
                    "name",
                )
                or frappe.db.get_single_value("RA Bill Settings", "mobilization_advance_account")
            )

        if advance_acc and self.company:
            acc_company = frappe.db.get_value("Account", advance_acc, "company")
            if acc_company and acc_company != self.company:
                acc_name = frappe.db.get_value("Account", advance_acc, "account_name")
                matched_acc = frappe.db.get_value("Account", {"account_name": acc_name, "company": self.company}, "name")
                if matched_acc:
                    advance_acc = matched_acc

        if not advance_acc:
            frappe.throw(_("Advance Account is not configured."))

        gl_entries = []

        total_deductions = sum(flt(d.amount) for d in self.get("deductions") if d.amount)
        ref_allocated = sum(
            flt(r.allocated_amount or r.total_amount)
            for r in self.references
            if r.reference_doctype == "RAB Work Order"
        )
        if ref_allocated > 0:
            gross_amount = ref_allocated
        elif flt(self.paid_amount) > 0:
            gross_amount = flt(self.paid_amount) if not total_deductions else (flt(self.paid_amount) + total_deductions)
        else:
            gross_amount = 0.0

        advance_currency = frappe.get_cached_value("Account", advance_acc, "account_currency") or self.company_currency
        exch_rate = flt(getattr(self, "target_exchange_rate", 1.0)) or 1.0

        # 1. Debit Advance Asset Account (Full Gross Advance Amount)
        gl_entries.append(
            self.get_gl_dict(
                {
                    "account": advance_acc,
                    "account_currency": advance_currency,
                    "against": self.party or self.paid_from,
                    "debit_in_account_currency": gross_amount,
                    "debit_in_transaction_currency": gross_amount / exch_rate,
                    "debit": gross_amount,
                    "cost_center": self.cost_center or frappe.get_cached_value("Company", self.company, "cost_center"),
                }
            )
        )

        # 2. Credit Deductions (e.g. TDS Payable)
        for d in self.get("deductions"):
            if not d.amount:
                continue
            amt = flt(d.amount)
            d_currency = frappe.get_cached_value("Account", d.account, "account_currency") or self.company_currency
            gl_entries.append(
                self.get_gl_dict(
                    {
                        "account": d.account,
                        "account_currency": d_currency,
                        "against": self.party or self.paid_from,
                        "credit_in_account_currency": amt,
                        "credit_in_transaction_currency": amt / exch_rate,
                        "credit": amt,
                        "cost_center": d.cost_center or self.cost_center,
                    },
                    item=d,
                )
            )

        # 3. Credit Bank / Cash Account (Net Outflow)
        net_bank_amount = gross_amount - total_deductions
        bank_currency = frappe.get_cached_value("Account", self.paid_from, "account_currency") or self.company_currency
        gl_entries.append(
            self.get_gl_dict(
                {
                    "account": self.paid_from,
                    "account_currency": bank_currency,
                    "against": advance_acc,
                    "credit_in_account_currency": net_bank_amount,
                    "credit_in_transaction_currency": net_bank_amount / exch_rate,
                    "credit": net_bank_amount,
                    "cost_center": self.cost_center,
                }
            )
        )

        from erpnext.accounts.general_ledger import make_gl_entries
        make_gl_entries(gl_entries, cancel=cancel, adv_adj=adv_adj)

    def on_submit(self):
        super().on_submit()
        update_ra_bill_hold_qty_from_pe(self)

    def on_cancel(self):
        super().on_cancel()
        update_ra_bill_hold_qty_from_pe(self)


def update_ra_bill_hold_qty_from_pe(doc, method=None):
    """
    Hook called on Payment Entry submission and cancellation.
    Whenever a Payment Entry linked to a Purchase Invoice with a populated ra_bill field
    is submitted or cancelled, recalculates how much of the Hold VALUE has been paid cumulative
    across all submitted Payment Entries for this invoice beyond the immediately-payable portion,
    and updates the linked RA Bill's item rows (hold_qty) and parent total_hold_value via db_set.

    DOCUMENTED ASSUMPTION:
    In most real cases there will only be one item row with a hold on a given bill, so the
    proportional distribution is mainly a safety mechanism for the rare multi-row-hold case,
    since true per-row payment allocation isn't tracked by Frappe/ERPNext at the line-item level.
    """
    if not doc or not getattr(doc, "references", None):
        return

    for ref in doc.references:
        if ref.reference_doctype == "Purchase Invoice" and ref.reference_name:
            ra_bill_name = frappe.db.get_value("Purchase Invoice", ref.reference_name, "ra_bill")
            if ra_bill_name:
                recalculate_ra_bill_hold_qty(ra_bill_name, invoice_name=ref.reference_name)


def recalculate_ra_bill_hold_qty(ra_bill_name, invoice_name=None):
    """
    Recalculates hold_qty on RA Bill items and total_hold_value on RA Bill parent.
    Formula:
      hold_value_paid_so_far = max(0, total_paid_across_all_submitted_PEs_for_this_PI - immediately_payable_amount)
      hold_value_paid_so_far = min(hold_value_paid_so_far, total_hold_value) # never exceed original hold value
      hold_value_pending = total_hold_value - hold_value_paid_so_far

      for each item row with original_hold_qty > 0:
          row_hold_value = row.original_hold_qty * row.rate
          row_share = row_hold_value / total_hold_value
          row_hold_value_paid = hold_value_paid_so_far * row_share
          row_hold_qty_paid = row_hold_value_paid / row.rate
          row.hold_qty = max(0, original_hold_qty - row_hold_qty_paid) # updated via db_set
    """
    if not ra_bill_name:
        return

    ra_bill = frappe.get_doc("RA Bill", ra_bill_name)
    if not ra_bill.items:
        return

    if not invoice_name:
        invoice_name = ra_bill.purchase_invoice
    if not invoice_name:
        return

    # 1. Ensure original_hold_qty is populated on rows
    has_any_hold = False
    for r in ra_bill.items:
        orig = flt(getattr(r, "original_hold_qty", 0))
        cur = flt(getattr(r, "hold_qty", 0))
        if orig <= 0 and cur > 0:
            orig = cur
            frappe.db.set_value("RA Bill Item", r.name, "original_hold_qty", orig, update_modified=False)
            r.original_hold_qty = orig
        if orig > 0:
            has_any_hold = True

    if not has_any_hold:
        return

    orig_total_hold_value = flt(ra_bill.get("original_total_hold_value") or 0.0)
    calculated_orig_hold_value = sum(flt(r.original_hold_qty) * flt(r.rate) for r in ra_bill.items)
    if calculated_orig_hold_value > 0 and (orig_total_hold_value <= 0 or abs(orig_total_hold_value - calculated_orig_hold_value) > 0.01):
        orig_total_hold_value = calculated_orig_hold_value
        frappe.db.set_value("RA Bill", ra_bill.name, "original_total_hold_value", round(orig_total_hold_value, 2), update_modified=False)

    if orig_total_hold_value <= 0:
        return

    # 2. Determine immediately payable amount
    gross_work_value = flt(ra_bill.gross_work_value)
    net_payable = flt(ra_bill.net_payable)
    if gross_work_value > 0 and net_payable > 0:
        hold_fraction = orig_total_hold_value / gross_work_value
        immediately_payable_amount = round(max(0.0, net_payable * (1.0 - hold_fraction)), 2)
    else:
        immediately_payable_amount = 0.0

    # 3. Calculate cumulative paid so far across all submitted PEs for this PI
    pi_outstanding = flt(frappe.db.get_value("Purchase Invoice", invoice_name, "outstanding_amount"))

    submitted_pes = frappe.db.sql("""
        SELECT pe.name, pe.paid_amount, per.allocated_amount
        FROM `tabPayment Entry Reference` per
        JOIN `tabPayment Entry` pe ON pe.name = per.parent
        WHERE per.reference_doctype = 'Purchase Invoice'
          AND per.reference_name = %s
          AND pe.docstatus = 1
    """, (invoice_name,), as_dict=True)

    # If invoice is fully settled (outstanding <= 0.005) and submitted PEs exist, full hold is paid
    if pi_outstanding <= 0.005 and len(submitted_pes) > 0:
        hold_value_paid_so_far = orig_total_hold_value
    else:
        total_paid_across_all_submitted_pes = sum(flt(p.paid_amount) for p in submitted_pes)
        hold_value_paid_so_far = max(0.0, total_paid_across_all_submitted_pes - immediately_payable_amount)
        hold_value_paid_so_far = min(hold_value_paid_so_far, orig_total_hold_value)

    # 4. Proportional distribution across all rows that have original_hold_qty > 0
    # In most real cases there is only 1 row with a hold. Proportional distribution handles multi-row holds safely.
    for row in ra_bill.items:
        orig_row_hold = flt(getattr(row, "original_hold_qty", 0))
        if orig_row_hold <= 0:
            continue
        rate = flt(row.rate)
        if rate <= 0:
            continue

        row_hold_value = orig_row_hold * rate
        row_share = row_hold_value / orig_total_hold_value if orig_total_hold_value > 0 else 0.0
        row_hold_value_paid = hold_value_paid_so_far * row_share
        row_hold_qty_paid = row_hold_value_paid / rate
        new_hold_qty = max(0.0, round(orig_row_hold - row_hold_qty_paid, 4))

        frappe.db.set_value("RA Bill Item", row.name, "hold_qty", new_hold_qty, update_modified=False)
        row.hold_qty = new_hold_qty

    # 5. Recalculate and update total_hold_value, total_hold_qty, original totals on parent RA Bill
    new_total_hold_value = sum(flt(r.hold_qty) * flt(r.rate) for r in ra_bill.items)
    new_total_hold_qty = sum(flt(r.hold_qty) for r in ra_bill.items)
    orig_total_hold_qty = sum(flt(getattr(r, "original_hold_qty", 0)) for r in ra_bill.items)

    frappe.db.set_value("RA Bill", ra_bill.name, {
        "total_hold_value": round(new_total_hold_value, 2),
        "total_hold_qty": round(new_total_hold_qty, 4),
        "original_total_hold_qty": round(orig_total_hold_qty, 4),
        "original_total_hold_value": round(orig_total_hold_value, 2),
    }, update_modified=False)