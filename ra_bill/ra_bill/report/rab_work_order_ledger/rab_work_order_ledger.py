# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, fmt_money


def execute(filters=None):
	if not filters:
		filters = {}

	columns = get_columns()
	data = get_data(filters)
	message = get_summary_message(filters)
	report_summary = get_report_summary(filters)

	return columns, data, message, None, report_summary


def get_columns():
	return [
		{
			"fieldname": "posting_date",
			"label": _("Posting Date"),
			"fieldtype": "Date",
			"width": 110,
		},
		{
			"fieldname": "account",
			"label": _("Account"),
			"fieldtype": "Link",
			"options": "Account",
			"width": 220,
		},
		{
			"fieldname": "amount",
			"label": _("Amount"),
			"fieldtype": "Currency",
			"width": 130,
		},
		{
			"fieldname": "entry_type",
			"label": _("Type"),
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"fieldname": "voucher_no",
			"label": _("Voucher No"),
			"fieldtype": "Link",
			"options": "RAB Work Order",
			"width": 160,
		},
		{
			"fieldname": "source_voucher",
			"label": _("Source Voucher"),
			"fieldtype": "Dynamic Link",
			"options": "source_doctype",
			"width": 180,
		},
		{
			"fieldname": "status",
			"label": _("Status"),
			"fieldtype": "Data",
			"width": 110,
		},
	]


def get_data(filters):
	rab_work_order = filters.get("rab_work_order")
	if not rab_work_order:
		return []

	# 1. Identify all RA Bills linked to the selected RAB Work Order (not cancelled)
	rabs = frappe.get_all(
		"RA Bill",
		filters={"boq": rab_work_order, "docstatus": ["!=", 2]},
		fields=["name", "gross_work_value", "gst_amount", "total_invoice_value", "purchase_invoice", "creation", "docstatus"],
		order_by="creation asc",
		limit_page_length=0,
	)
	rab_names = [r.name for r in rabs]

	# Linked Purchase Invoices (via ra_bill.purchase_invoice or pi.ra_bill)
	pi_list = frappe.db.sql(
		"""
		SELECT name, docstatus, posting_date, grand_total, outstanding_amount, ra_bill, credit_to
		FROM `tabPurchase Invoice`
		WHERE docstatus != 2 AND (
			ra_bill IN %s
			OR name IN %s
		)
		ORDER BY creation ASC
		""",
		(tuple(rab_names or [""]), tuple([r.purchase_invoice for r in rabs if r.purchase_invoice] or [""])),
		as_dict=True,
	) or []
	pi_names = [p.name for p in pi_list]

	# Advances linked directly on RAB Work Order
	wo_advances = frappe.get_all(
		"RAB Work Order Advance",
		filters={"parent": rab_work_order},
		fields=["advance_type", "description", "amount", "payment_entry"],
	)
	adv_pe_names = [a.payment_entry for a in wo_advances if a.payment_entry]

	# 2. Identify all Payment Entries linked to the selected RAB Work Order (not cancelled):
	pes = (
		frappe.db.sql(
			"""
			SELECT DISTINCT pe.name, pe.posting_date, pe.payment_type, pe.paid_amount, pe.received_amount, pe.is_mobilization_advance, pe.is_adhoc_advance, pe.creation, pe.docstatus, pe.mode_of_payment, pe.paid_from, pe.paid_to
			FROM `tabPayment Entry` pe
			LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE pe.docstatus != 2 AND (
				(per.reference_doctype = 'RAB Work Order' AND per.reference_name = %s)
				OR pe.work_order = %s
				OR (
					per.reference_doctype = 'Purchase Invoice'
					AND per.reference_name IN %s
				)
				OR (
					per.reference_doctype = 'RA Bill'
					AND per.reference_name IN %s
				)
				OR pe.name IN %s
			)
			ORDER BY pe.posting_date ASC, pe.creation ASC
			""",
			(rab_work_order, rab_work_order, tuple(pi_names or [""]), tuple(rab_names or [""]), tuple(adv_pe_names or [""])),
			as_dict=True,
		)
		or []
	)

	if not rabs and not pes and not pi_list:
		return []

	pe_docs = {p["name"]: frappe.get_doc("Payment Entry", p["name"]) for p in pes}

	def is_mob_pe(pe_dict):
		p_doc = pe_docs.get(pe_dict["name"])
		if p_doc and p_doc.is_mobilization_advance:
			return True
		return any(a.payment_entry == pe_dict["name"] and a.advance_type == "Mobilization Advance" for a in wo_advances)

	def is_adhoc_pe(pe_dict):
		p_doc = pe_docs.get(pe_dict["name"])
		if p_doc and p_doc.is_adhoc_advance:
			return True
		return any(a.payment_entry == pe_dict["name"] and a.advance_type in ("Ad Hoc Advance", "Other") for a in wo_advances)

	adhoc_pes = [p for p in pes if is_adhoc_pe(p)]
	mob_pes = [p for p in pes if is_mob_pe(p) and p not in adhoc_pes]
	normal_pes = [p for p in pes if p not in adhoc_pes and p not in mob_pes]

	processed_vouchers = set()

	def get_gl_rows_for_voucher(voucher_type, voucher_no, docstatus=1):
		processed_vouchers.add((voucher_type, voucher_no))
		gls = frappe.db.sql(
			"""
			SELECT posting_date, account, debit, credit, voucher_type, voucher_no, remarks
			FROM `tabGL Entry`
			WHERE is_cancelled = 0 AND voucher_type = %s AND voucher_no = %s
			ORDER BY posting_date ASC, creation ASC, name ASC
			""",
			(voucher_type, voucher_no),
			as_dict=True,
		)

		status_str = "Draft" if docstatus == 0 else ("Submitted" if docstatus == 1 else "Cancelled")
		rows = []
		for g in gls:
			debit = flt(g.debit)
			credit = flt(g.credit)
			account = g.account
			acc_type = frappe.db.get_value("Account", account, "account_type")

			if voucher_type == "Purchase Invoice":
				if credit > 0 and acc_type == "Payable":
					amt = credit
					entry_type = "Invoice Liability"
				elif acc_type == "Tax" or "Tax" in account or "GST" in account:
					amt = debit
					entry_type = "GST"
				else:
					amt = debit
					entry_type = "Gross Work Value"
			else:  # Payment Entry
				pe_doc = pe_docs.get(voucher_no)
				is_adv = is_mob_pe(pe_doc.as_dict()) or is_adhoc_pe(pe_doc.as_dict()) if pe_doc else False

				if not is_adv and acc_type == "Payable" and debit > 0:
					continue

				if acc_type in ("Bank", "Cash") or "Bank" in account or "Cash" in account:
					amt = credit
					entry_type = "Net Advance Paid" if is_adv else "Net Payment"
				elif is_adv and debit > 0:
					amt = debit
					entry_type = "Advance Disbursed"
				else:
					amt = -abs(credit or debit)
					if "Retention" in account:
						entry_type = "Deduction (Retention)"
					elif "TDS" in account:
						entry_type = "Deduction (TDS)"
					elif "Labour" in account:
						entry_type = "Deduction (Labour Cess)"
					elif "Mobilization" in account or "Advance Recovery" in account:
						entry_type = "Advance Recovery"
					elif "Retention" in (g.remarks or ""):
						entry_type = "Deduction (Retention)"
					elif "TDS" in (g.remarks or ""):
						entry_type = "Deduction (TDS)"
					elif "Labour" in (g.remarks or ""):
						entry_type = "Deduction (Labour Cess)"
					elif "Recovery" in (g.remarks or ""):
						entry_type = "Advance Recovery"
					else:
						entry_type = "Deduction"

			rows.append(
				{
					"posting_date": str(g.posting_date),
					"account": account,
					"debit": debit,
					"credit": credit,
					"amount": amt,
					"entry_type": entry_type,
					"voucher_no": rab_work_order,
					"source_voucher": voucher_no,
					"source_doctype": voucher_type,
					"is_header": 0,
					"status": status_str,
					"docstatus": docstatus,
				}
			)
		return rows

	def get_rows_for_voucher(voucher_type, voucher_no, docstatus=1):
		gl_rows = get_gl_rows_for_voucher(voucher_type, voucher_no, docstatus=docstatus)
		if gl_rows:
			return gl_rows

		# Fallback for Draft vouchers or vouchers with no GL entries yet
		status_str = "Draft" if docstatus == 0 else ("Submitted" if docstatus == 1 else "Cancelled")
		if voucher_type == "Payment Entry":
			pe_doc = pe_docs.get(voucher_no) or frappe.get_doc("Payment Entry", voucher_no)
			is_adv = is_mob_pe(pe_doc.as_dict()) or is_adhoc_pe(pe_doc.as_dict())
			entry_type = "Advance Disbursed" if is_adv else "Net Payment"
			account = pe_doc.paid_from or pe_doc.paid_to or "Payment Entry"
			return [{
				"posting_date": str(pe_doc.posting_date or ""),
				"account": account,
				"debit": flt(pe_doc.paid_amount),
				"credit": 0.0,
				"amount": flt(pe_doc.paid_amount),
				"entry_type": entry_type,
				"voucher_no": rab_work_order,
				"source_voucher": voucher_no,
				"source_doctype": voucher_type,
				"is_header": 0,
				"status": status_str,
				"docstatus": docstatus,
			}]
		elif voucher_type == "Purchase Invoice":
			pi_doc = frappe.get_doc("Purchase Invoice", voucher_no)
			return [{
				"posting_date": str(pi_doc.posting_date or ""),
				"account": pi_doc.credit_to or "Creditors",
				"debit": 0.0,
				"credit": flt(pi_doc.grand_total),
				"amount": flt(pi_doc.grand_total),
				"entry_type": "Invoice Liability",
				"voucher_no": rab_work_order,
				"source_voucher": voucher_no,
				"source_doctype": voucher_type,
				"is_header": 0,
				"status": status_str,
				"docstatus": docstatus,
			}]
		elif voucher_type == "RA Bill":
			rab_doc = frappe.get_doc("RA Bill", voucher_no)
			return [{
				"posting_date": str(rab_doc.posting_date or ""),
				"account": "RA Bill Measurement",
				"debit": flt(rab_doc.gross_work_value),
				"credit": 0.0,
				"amount": flt(rab_doc.gross_work_value),
				"entry_type": "Gross Work Value",
				"voucher_no": rab_work_order,
				"source_voucher": voucher_no,
				"source_doctype": voucher_type,
				"is_header": 0,
				"status": status_str,
				"docstatus": docstatus,
			}]
		return []

	def make_header_row(header_text, voucher_no="", voucher_type="", docstatus=1):
		status_str = "Draft" if docstatus == 0 else ("Submitted" if docstatus == 1 else "Cancelled")
		return {
			"posting_date": "",
			"account": f"<b>{header_text}</b>",
			"debit": 0.0,
			"credit": 0.0,
			"amount": None,
			"entry_type": "",
			"voucher_no": rab_work_order,
			"source_voucher": voucher_no,
			"source_doctype": voucher_type,
			"is_header": 1,
			"status": status_str,
			"docstatus": docstatus,
		}

	data = []

	# Section 1: Ad Hoc Advance
	for pe in adhoc_pes:
		header = f"Ad Hoc Advance — {pe['name']}"
		data.append(make_header_row(header, pe["name"], "Payment Entry", docstatus=pe["docstatus"]))
		data.extend(get_rows_for_voucher("Payment Entry", pe["name"], docstatus=pe["docstatus"]))

	# Section 2: Mobilization Advance
	for pe in mob_pes:
		header = f"Mobilization Advance — {pe['name']}"
		data.append(make_header_row(header, pe["name"], "Payment Entry", docstatus=pe["docstatus"]))
		data.extend(get_rows_for_voucher("Payment Entry", pe["name"], docstatus=pe["docstatus"]))

	# Section 3: RA Bills (RA Bill 1, RA Bill 2...)
	for idx, rab in enumerate(rabs, 1):
		header = f"RA Bill {idx} — {rab.name}"
		data.append(make_header_row(header, rab.name, "RA Bill", docstatus=rab.docstatus))
		if rab.docstatus == 0:
			data.extend(get_rows_for_voucher("RA Bill", rab.name, docstatus=0))

		# Check all PIs linked to this RA bill
		linked_pis = [p for p in pi_list if p.ra_bill == rab.name or p.name == rab.purchase_invoice]
		for pi in linked_pis:
			data.extend(get_rows_for_voucher("Purchase Invoice", pi.name, docstatus=pi.docstatus))

			linked_pes = [
				p
				for p in normal_pes
				if any(r.reference_name == pi.name for r in (getattr(pe_docs[p["name"]], "references", []) or []))
			]
			for pe in linked_pes:
				data.extend(get_rows_for_voucher("Payment Entry", pe["name"], docstatus=pe["docstatus"]))

	# Any remaining qualifying Payment Entries not captured in above sections
	remaining_pes = [p for p in pes if ("Payment Entry", p["name"]) not in processed_vouchers]
	if remaining_pes:
		data.append(make_header_row("Other Payments", "", "", docstatus=1))
		for pe in remaining_pes:
			data.extend(get_rows_for_voucher("Payment Entry", pe["name"], docstatus=pe["docstatus"]))

	return data


def get_summary_metrics(rab_work_order):
	if not rab_work_order:
		return {}

	wo = frappe.get_doc("RAB Work Order", rab_work_order)
	contract_value = flt(wo.contract_value or wo.total_boq_amount)

	rabs = frappe.get_all(
		"RA Bill",
		filters={"boq": rab_work_order, "docstatus": 1},
		fields=[
			"name",
			"gross_work_value",
			"gst_amount",
			"total_invoice_value",
			"retention_amount",
			"tds_amount",
			"mobilization_recovery_amount",
			"purchase_invoice",
		],
		limit_page_length=0,
	)

	gross_work_value = sum(flt(r.gross_work_value) for r in rabs)
	gst_amount = sum(flt(r.gst_amount) for r in rabs)
	invoice_value = sum(flt(r.total_invoice_value) for r in rabs)
	retention_total = sum(flt(r.retention_amount) for r in rabs)
	tds_total = sum(flt(r.tds_amount) for r in rabs)
	mob_recovery_total = sum(flt(r.mobilization_recovery_amount) for r in rabs)

	rab_names = [r.name for r in rabs]
	pi_list = frappe.db.sql(
		"""
		SELECT name, docstatus
		FROM `tabPurchase Invoice`
		WHERE docstatus = 1 AND (
			ra_bill IN %s
			OR name IN %s
		)
		""",
		(tuple(rab_names or [""]), tuple([r.purchase_invoice for r in rabs if r.purchase_invoice] or [""])),
		as_dict=True,
	) or []
	pi_names = [p.name for p in pi_list]

	wo_advances = frappe.get_all(
		"RAB Work Order Advance",
		filters={"parent": rab_work_order},
		fields=["advance_type", "amount", "payment_entry"],
	)
	adv_pe_names = [a.payment_entry for a in wo_advances if a.payment_entry]

	pes = (
		frappe.db.sql(
			"""
			SELECT DISTINCT pe.name
			FROM `tabPayment Entry` pe
			LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE pe.docstatus = 1 AND (
				(per.reference_doctype = 'RAB Work Order' AND per.reference_name = %s)
				OR pe.work_order = %s
				OR (
					per.reference_doctype = 'Purchase Invoice'
					AND per.reference_name IN %s
				)
				OR (
					per.reference_doctype = 'RA Bill'
					AND per.reference_name IN %s
				)
				OR pe.name IN %s
			)
			""",
			(rab_work_order, rab_work_order, tuple(pi_names or [""]), tuple(rab_names or [""]), tuple(adv_pe_names or [""])),
			as_dict=True,
		)
		or []
	)

	original_advance = 0.0
	total_net_paid = 0.0
	labour_cess_total = 0.0
	adhoc_recovery_total = 0.0

	for pe_row in pes:
		pe_doc = frappe.get_doc("Payment Entry", pe_row["name"])
		if pe_doc.is_mobilization_advance or pe_doc.is_adhoc_advance:
			original_advance += flt(pe_doc.paid_amount)
		else:
			total_net_paid += flt(pe_doc.paid_amount)
			for d in getattr(pe_doc, "deductions", []):
				desc = d.description or ""
				acc = d.account or ""
				if "Labour" in desc or "Labour" in acc:
					labour_cess_total += flt(d.amount)
				elif "Advance Recovery" in desc or "Advance Recovery" in acc:
					adhoc_recovery_total += flt(d.amount)

	if original_advance == 0:
		original_advance = sum(flt(a.amount) for a in wo_advances if a.advance_type in ("Mobilization Advance", "Ad Hoc Advance"))

	total_advance_recovered = mob_recovery_total + adhoc_recovery_total
	total_deductions = retention_total + tds_total + labour_cess_total + total_advance_recovered
	advance_outstanding = max(0.0, original_advance - total_advance_recovered)

	return {
		"contract_value": contract_value,
		"gross_work_value": gross_work_value,
		"gst_amount": gst_amount,
		"invoice_value": invoice_value,
		"retention_total": retention_total,
		"tds_total": tds_total,
		"labour_cess_total": labour_cess_total,
		"mob_recovery_total": mob_recovery_total,
		"total_advance_recovered": total_advance_recovered,
		"total_deductions": total_deductions,
		"total_net_paid": total_net_paid,
		"original_advance": original_advance,
		"advance_outstanding": advance_outstanding,
	}


def get_report_summary(filters):
	rab_work_order = filters.get("rab_work_order")
	if not rab_work_order:
		return []

	m = get_summary_metrics(rab_work_order)
	if not m:
		return []

	return [
		{
			"value": m["contract_value"],
			"label": _("Contract Value"),
			"datatype": "Currency",
		},
		{
			"value": m["gross_work_value"],
			"label": _("Gross Work Billed"),
			"datatype": "Currency",
		},
		{
			"value": m["gst_amount"],
			"label": _("GST Amount"),
			"datatype": "Currency",
		},
		{
			"value": m["invoice_value"],
			"label": _("Purchase Invoice Total"),
			"datatype": "Currency",
		},
		{
			"value": m["total_deductions"],
			"label": _("Total Deductions"),
			"datatype": "Currency",
			"indicator": "Red",
		},
		{
			"value": m["total_net_paid"],
			"label": _("Net Paid to Contractor"),
			"datatype": "Currency",
			"indicator": "Green",
		},
		{
			"value": m["original_advance"],
			"label": _("Original Advance Disbursed"),
			"datatype": "Currency",
		},
		{
			"value": m["total_advance_recovered"],
			"label": _("Advance Recovered"),
			"datatype": "Currency",
		},
		{
			"value": m["advance_outstanding"],
			"label": _("Advance Outstanding"),
			"datatype": "Currency",
			"indicator": "Red" if m["advance_outstanding"] > 0 else "Green",
		},
	]


def get_summary_message(filters):
	rab_work_order = filters.get("rab_work_order")
	if not rab_work_order:
		return ""

	m = get_summary_metrics(rab_work_order)
	if not m:
		return ""

	return f"""
	<div style="background-color: #f8f9fa; border: 1px solid #d1d8dd; border-radius: 6px; padding: 15px; margin-bottom: 15px;">
		<div style="font-size: 15px; font-weight: 600; color: #2e3b4e; margin-bottom: 12px; border-bottom: 2px solid #5e64ff; padding-bottom: 4px;">
			RAB Work Order Accounting Flow & Financial Position Summary
		</div>
		<div style="display: flex; flex-wrap: wrap; gap: 20px;">
			<div style="flex: 1; min-width: 250px; background: #ffffff; padding: 12px; border-radius: 4px; border: 1px solid #e2e8f0;">
				<div style="font-weight: 600; color: #4a5568; margin-bottom: 8px;">Billing & Invoice</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Gross Work Billed:</span> <strong>{fmt_money(m['gross_work_value'], currency='INR')}</strong></div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>GST:</span> <strong>{fmt_money(m['gst_amount'], currency='INR')}</strong></div>
				<div style="display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e0; pt: 4px; margin-top: 4px; font-size: 14px;"><span>Invoice Value:</span> <strong style="color: #2b6cb0;">{fmt_money(m['invoice_value'], currency='INR')}</strong></div>
			</div>
			<div style="flex: 1; min-width: 280px; background: #ffffff; padding: 12px; border-radius: 4px; border: 1px solid #e2e8f0;">
				<div style="font-weight: 600; color: #4a5568; margin-bottom: 8px;">Deductions & Recoveries</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Retention:</span> <span style="color: #c53030;">-{fmt_money(m['retention_total'], currency='INR')}</span></div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>TDS:</span> <span style="color: #c53030;">-{fmt_money(m['tds_total'], currency='INR')}</span></div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Labour Cess:</span> <span style="color: #c53030;">-{fmt_money(m['labour_cess_total'], currency='INR')}</span></div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Advance Recovery:</span> <span style="color: #c53030;">-{fmt_money(m['total_advance_recovered'], currency='INR')}</span></div>
				<div style="display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e0; pt: 4px; margin-top: 4px; font-size: 14px;"><span>Net Paid to Contractor:</span> <strong style="color: #276749;">{fmt_money(m['total_net_paid'], currency='INR')}</strong></div>
			</div>
			<div style="flex: 1; min-width: 250px; background: #ffffff; padding: 12px; border-radius: 4px; border: 1px solid #e2e8f0;">
				<div style="font-weight: 600; color: #4a5568; margin-bottom: 8px;">Mobilization / Ad Hoc Advance</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Original Advance Disbursed:</span> <strong>{fmt_money(m['original_advance'], currency='INR')}</strong></div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Recovered to Date:</span> <span style="color: #276749;">{fmt_money(m['total_advance_recovered'], currency='INR')}</span></div>
				<div style="display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e0; pt: 4px; margin-top: 4px; font-size: 14px;"><span>Balance Outstanding:</span> <strong style="color: #c53030;">{fmt_money(m['advance_outstanding'], currency='INR')}</strong></div>
			</div>
		</div>
	</div>
	"""
