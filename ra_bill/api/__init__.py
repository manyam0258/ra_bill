import frappe
from frappe import _
from frappe.model.workflow import get_workflow_name, get_transitions, apply_workflow


@frappe.whitelist()
def get_workflow_details(doctype: str, name: str):
	"""
	Returns the document's current workflow state and all available transitions
	allowed for the current user.
	"""
	doc = frappe.get_doc(doctype, name)
	workflow_name = get_workflow_name(doctype)
	if not workflow_name:
		return {
			"has_workflow": False,
			"workflow_state": None,
			"docstatus": doc.docstatus,
			"transitions": [],
		}

	workflow = frappe.get_doc("Workflow", workflow_name)
	state_field = workflow.workflow_state_field
	current_state = doc.get(state_field) or "Draft"

	transitions = get_transitions(doc)

	return {
		"has_workflow": True,
		"workflow_name": workflow_name,
		"state_field": state_field,
		"workflow_state": current_state,
		"docstatus": doc.docstatus,
		"transitions": [
			{
				"action": t.action,
				"next_state": t.next_state,
				"allowed": t.allowed,
			}
			for t in transitions
		],
	}


@frappe.whitelist()
def apply_workflow_action(doctype: str, name: str, action: str):
	"""
	Applies a workflow action using Frappe's standard workflow engine.
	"""
	doc = frappe.get_doc(doctype, name)
	updated_doc = apply_workflow(doc, action)
	return updated_doc.as_dict()


@frappe.whitelist()
def create_rab_invoice(ra_bill: str):
	"""
	Creates a Purchase Invoice (or Sales Invoice) from an approved RA Bill using
	Frappe Desk's make_invoice logic.
	"""
	from ra_bill.ra_bill.doctype.ra_bill.ra_bill import make_invoice

	doc = frappe.get_doc("RA Bill", ra_bill)
	if doc.docstatus == 0:
		wf_state = getattr(doc, "workflow_state", None)
		if wf_state in ["Approved", "Ready to Invoice"]:
			doc.submit()
		else:
			frappe.throw(_("Submit the RA Bill before generating an invoice."))

	invoice_name = make_invoice(ra_bill)
	return {"invoice_name": invoice_name, "bill_type": doc.bill_type}


@frappe.whitelist()
def get_default_payment_account(mode_of_payment: str = None, company: str = None):
	"""
	Resolves the default paid_from account matching core Frappe/ERPNext logic:
	1. Mode of Payment Account mapping for (mode_of_payment, company)
	2. If MoP type is Bank -> Company.default_bank_account
	3. If MoP type is Cash -> Company.default_cash_account
	4. Fallback -> Company default bank or cash account
	5. Fallback -> First active Bank or Cash account of company
	"""
	if not company:
		company = frappe.defaults.get_user_default("Company") or "Tridasa"

	# 1. Mode of Payment Account mapping
	if mode_of_payment:
		acc = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": mode_of_payment, "company": company},
			"default_account",
		)
		if acc:
			return {"account": acc}

	# Check Mode of Payment type
	mop_type = None
	if mode_of_payment:
		mop_type = frappe.db.get_value("Mode of Payment", mode_of_payment, "type")

	# 2. Company defaults according to MoP type
	if mop_type == "Bank":
		bank_acc = frappe.db.get_value("Company", company, "default_bank_account")
		if bank_acc:
			return {"account": bank_acc}
	elif mop_type == "Cash":
		cash_acc = frappe.db.get_value("Company", company, "default_cash_account")
		if cash_acc:
			return {"account": cash_acc}

	# 3. Fallbacks on company defaults
	bank_acc = frappe.db.get_value("Company", company, "default_bank_account")
	if bank_acc:
		return {"account": bank_acc}

	cash_acc = frappe.db.get_value("Company", company, "default_cash_account")
	if cash_acc:
		return {"account": cash_acc}

	# 4. Any active bank or cash account for this company
	any_acc = frappe.db.get_value(
		"Account",
		{"company": company, "account_type": ["in", ["Bank", "Cash"]], "is_group": 0},
		"name",
	)
	return {"account": any_acc or ""}


@frappe.whitelist()
def create_payment_entry_from_invoice(
	invoice_name: str,
	reference_no: str = None,
	reference_date: str = None,
	mode_of_payment: str = None,
	paid_from: str = None,
	auto_submit: bool = False,
	custom_amount: float = None,
):
	"""
	Creates a Payment Entry linked to a Purchase Invoice using ERPNext's get_payment_entry logic.
	Accepts optional reference_no, reference_date, mode_of_payment, paid_from, auto_submit, and custom_amount.
	Auto-resolves paid_from from Mode of Payment and Company if not explicitly supplied.

	When custom_amount is provided:
	Validates 0 < custom_amount <= outstanding_amount.
	Allocates custom_amount directly as paid_amount / allocated_amount.

	When custom_amount is omitted (default):
	Hold-fraction logic: when the linked RA Bill has a hold portion and it is the first PE,
	the PE's paid_amount and allocated_amount are reduced to the "immediately payable"
	amount only. This leaves the hold portion as PI outstanding_amount to be cleared by subsequent PEs.

	auto_submit defaults to False — the PE is always left in Draft for the user
	to review and manually submit. Pass auto_submit=True only if an explicit
	auto-submit is required.
	"""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
	from frappe.utils import nowdate, flt as _flt

	# Parse and validate custom_amount if provided
	if custom_amount is not None and str(custom_amount).strip() != "":
		custom_amount = round(_flt(custom_amount), 2)
	else:
		custom_amount = None

	pi_doc = frappe.get_doc("Purchase Invoice", invoice_name)
	pi_outstanding = round(_flt(pi_doc.outstanding_amount), 2)

	if custom_amount is not None:
		if custom_amount <= 0:
			frappe.throw(_("Amount to Pay must be greater than 0."))
		if custom_amount > pi_outstanding + 0.005:
			frappe.throw(
				_("Allocated Amount cannot be greater than outstanding amount ({0}).").format(
					frappe.format_value(pi_outstanding, {"fieldtype": "Currency"})
				)
			)

	# Sensible defaults so Bank account validation never fails
	if not reference_date:
		reference_date = nowdate()
	if not reference_no:
		reference_no = f"PAY-{invoice_name}"

	pe = get_payment_entry("Purchase Invoice", invoice_name)

	# Apply reference fields before insert — these are mandatory for Bank-type paid_from accounts
	pe.reference_no = reference_no
	pe.reference_date = reference_date

	if mode_of_payment:
		pe.mode_of_payment = mode_of_payment

	# Auto-populate paid_from account if missing
	if paid_from:
		pe.paid_from = paid_from
	elif not pe.paid_from or (mode_of_payment and pe.mode_of_payment == mode_of_payment):
		res = get_default_payment_account(pe.mode_of_payment or mode_of_payment, pe.company)
		if res.get("account"):
			pe.paid_from = res["account"]

	# Set dedicated work_order field on PE and remove any RAB Work Order rows from references table
	ra_bill_name = frappe.db.get_value("Purchase Invoice", invoice_name, "ra_bill")
	if ra_bill_name:
		wo_name = frappe.db.get_value("RA Bill", ra_bill_name, "boq")
		if wo_name:
			pe.work_order = wo_name

	pe.references = [r for r in pe.references if r.reference_doctype != "RAB Work Order"]

	# Check if any submitted PE already exists for this invoice
	existing_pe_count = frappe.db.count(
		"Payment Entry Reference",
		filters={
			"reference_doctype": "Purchase Invoice",
			"reference_name": invoice_name,
			"docstatus": 1,
		},
	)
	is_first_pe = existing_pe_count == 0

	immediately_payable_override = None  # will be set if auto-calculated hold override applies

	if custom_amount is not None:
		# User specified custom payment amount
		total_ra_deductions = 0.0
		if is_first_pe and ra_bill_name:
			ra_bill = frappe.get_doc("RA Bill", ra_bill_name)
			net_payable = _flt(ra_bill.get("net_payable"))
			pi_grand_total = _flt(frappe.db.get_value("Purchase Invoice", invoice_name, "grand_total"))
			total_ra_deductions = max(0.0, pi_grand_total - net_payable)

		ref_allocated = round(min(pi_outstanding, custom_amount + total_ra_deductions), 2)
		for ref in pe.get("references", []):
			if ref.reference_doctype == "Purchase Invoice" and ref.reference_name == invoice_name:
				ref.allocated_amount = ref_allocated
				break

		pe.paid_amount = custom_amount
		pe.received_amount = custom_amount
	else:
		# ── Default Hold-fraction adjustment ─────────────────────────────────────
		# Only applies to the FIRST Payment Entry for this Purchase Invoice when custom_amount not given.
		# For subsequent PEs (e.g. clearing the deferred Hold portion), the PI's
		# current outstanding_amount already correctly represents the remaining
		# balance, so ERPNext's standard get_payment_entry handles it naturally.
		if is_first_pe and ra_bill_name:
			ra_bill = frappe.get_doc("RA Bill", ra_bill_name)
			gross_work_value = _flt(ra_bill.get("gross_work_value"))
			total_hold_value = _flt(ra_bill.get("total_hold_value"))
			net_payable = _flt(ra_bill.get("net_payable"))

			if gross_work_value > 0 and total_hold_value > 0 and net_payable > 0:
				hold_fraction = total_hold_value / gross_work_value
				immediately_payable_override = round(max(0.0, net_payable * (1.0 - hold_fraction)), 2)

				pi_grand_total = _flt(frappe.db.get_value("Purchase Invoice", invoice_name, "grand_total"))
				total_ra_deductions = max(0.0, pi_grand_total - net_payable)
				gross_hold_allocated = round(immediately_payable_override + total_ra_deductions, 2)

				for ref in pe.get("references", []):
					if ref.reference_doctype == "Purchase Invoice" and ref.reference_name == invoice_name:
						ref.allocated_amount = gross_hold_allocated
						break

	pe.insert(ignore_permissions=True)

	# Ensure paid_amount / received_amount matches target amount after insert hooks
	target_paid_amount = custom_amount if custom_amount is not None else immediately_payable_override
	if target_paid_amount is not None:
		frappe.db.set_value(
			"Payment Entry",
			pe.name,
			{
				"paid_amount": target_paid_amount,
				"received_amount": target_paid_amount,
				"base_paid_amount": target_paid_amount,
				"base_received_amount": target_paid_amount,
			},
			update_modified=False,
		)

	# Extra safety: ensure no RAB Work Order reference row exists in the child table
	frappe.db.sql(
		"""
		DELETE FROM `tabPayment Entry Reference`
		WHERE parent = %s AND reference_doctype = 'RAB Work Order'
		""",
		(pe.name,),
	)

	# Issue 2: only submit when explicitly requested (auto_submit=True, default False).
	# The manual "Create Payment Entry" dialog sends auto_submit=False so the PE stays
	# in Draft for the user to review before submitting themselves.
	if auto_submit:
		try:
			pe.reload()  # Reload so submit sees the db_set values
			pe.submit()
		except Exception as e:
			frappe.log_error(f"Failed to auto-submit Payment Entry {pe.name}: {e}")
	return {"payment_entry": pe.name}


@frappe.whitelist()
def get_linked_payment_entries(doctype: str, name: str):
	"""
	Returns Payment Entry records genuinely linked to a Purchase Invoice, RA Bill, or RAB Work Order
	via tabPayment Entry Reference.
	"""
	if doctype == "Purchase Invoice":
		pi = frappe.get_doc("Purchase Invoice", name)
		pes_ref = frappe.db.sql(
			"""
			SELECT DISTINCT pe.name, pe.posting_date, pe.party_type, pe.party, pe.party_name, pe.paid_amount, pe.received_amount, pe.docstatus, pe.payment_type
			FROM `tabPayment Entry` pe
			INNER JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE per.reference_doctype = 'Purchase Invoice' AND per.reference_name = %s
			ORDER BY pe.creation DESC
		""",
			(name,),
			as_dict=True,
		)
		if not pes_ref and getattr(pi, "ra_bill", None):
			pes_ref = frappe.db.sql(
				"""
				SELECT DISTINCT pe.name, pe.posting_date, pe.party_type, pe.party, pe.party_name, pe.paid_amount, pe.received_amount, pe.docstatus, pe.payment_type
				FROM `tabPayment Entry` pe
				INNER JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
				WHERE per.reference_doctype = 'RA Bill' AND per.reference_name = %s
				ORDER BY pe.creation DESC
			""",
				(pi.ra_bill,),
				as_dict=True,
			)
		return pes_ref

	elif doctype == "RA Bill":
		return frappe.db.sql(
			"""
			SELECT DISTINCT pe.name, pe.posting_date, pe.party_type, pe.party, pe.party_name, pe.paid_amount, pe.received_amount, pe.docstatus, pe.payment_type
			FROM `tabPayment Entry` pe
			INNER JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE per.reference_doctype = 'RA Bill' AND per.reference_name = %s
			ORDER BY pe.creation DESC
		""",
			(name,),
			as_dict=True,
		)

	elif doctype == "RAB Work Order":
		return frappe.db.sql(
			"""
			SELECT DISTINCT pe.name, pe.posting_date, pe.party_type, pe.party, pe.party_name, pe.paid_amount, pe.received_amount, pe.docstatus, pe.payment_type
			FROM `tabPayment Entry` pe
			LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE pe.docstatus != 2 AND (
				pe.work_order = %s
				OR (per.reference_doctype = 'RAB Work Order' AND per.reference_name = %s)
			)
			ORDER BY pe.creation DESC
		""",
			(name, name),
			as_dict=True,
		)

	return []


@frappe.whitelist()
def get_rab_ledger(work_order=None, supplier=None):
	"""
	Fetches full ledger trail (RAB Work Orders, RA Bills, Purchase Invoices, Payment Entries)
	filtered by Work Order or Vendor/Supplier.
	"""
	wo_filters = {}
	if work_order and work_order != "all":
		wo_filters["name"] = work_order
	if supplier:
		wo_filters["supplier"] = supplier

	work_orders = frappe.get_all(
		"RAB Work Order",
		filters=wo_filters,
		fields=[
			"name",
			"project",
			"supplier",
			"customer",
			"contract_value",
			"total_boq_amount",
			"mobilization_advance_amount",
			"creation",
			"status",
			"docstatus",
		],
		order_by="creation desc",
	)

	wo_names = [w.name for w in work_orders]

	bill_filters = [["docstatus", "=", 1]]
	if work_order and work_order != "all":
		bill_filters.append(["boq", "=", work_order])
	elif supplier:
		bill_filters.append(["supplier", "=", supplier])

	ra_bills = frappe.get_all(
		"RA Bill",
		filters=bill_filters,
		fields=[
			"name",
			"ra_bill_no",
			"project",
			"boq",
			"posting_date",
			"gross_work_value",
			"gst_amount",
			"total_invoice_value",
			"billable_value",
			"net_payable",
			"total_deductions",
			"retention_amount",
			"tds_amount",
			"labour_cess_amount",
			"mobilization_recovery_amount",
			"supplier",
			"customer",
			"purchase_invoice",
			"docstatus",
		],
		order_by="ra_bill_no asc",
	)

	bill_names = [r.name for r in ra_bills]
	pi_names = [r.purchase_invoice for r in ra_bills if r.purchase_invoice]

	payment_entries = []
	refs_to_check = []
	if pi_names:
		refs_to_check.extend([("Purchase Invoice", pinv) for pinv in pi_names])
	if bill_names:
		refs_to_check.extend([("RA Bill", b) for b in bill_names])
	if wo_names:
		refs_to_check.extend([("RAB Work Order", w) for w in wo_names])

	if refs_to_check or wo_names:
		where_clauses = []
		params = []
		for dt, dn in refs_to_check:
			where_clauses.append("(per.reference_doctype = %s AND per.reference_name = %s)")
			params.extend([dt, dn])

		if wo_names:
			where_clauses.append("pe.work_order IN %s")
			params.append(tuple(wo_names))

		clause_str = " OR ".join(where_clauses)
		payment_entries = frappe.db.sql(
			f"""
			SELECT DISTINCT pe.name, pe.posting_date, pe.party_type, pe.party, pe.party_name, pe.paid_amount, pe.received_amount, pe.docstatus, per.reference_doctype, per.reference_name
			FROM `tabPayment Entry` pe
			LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
			WHERE pe.docstatus != 2 AND ({clause_str})
			ORDER BY pe.posting_date asc
		""",
			tuple(params),
			as_dict=True,
		)

	return {
		"work_orders": work_orders,
		"ra_bills": ra_bills,
		"payment_entries": payment_entries,
	}


@frappe.whitelist()
def run_rab_work_order_ledger(rab_work_order: str):
	"""
	Runs Frappe Desk's 'RAB Work Order Ledger' report and returns columns, result rows,
	summary message, and 9 report summary metrics.
	"""
	from ra_bill.ra_bill.report.rab_work_order_ledger.rab_work_order_ledger import execute

	columns, data, message, chart, report_summary = execute(filters={"rab_work_order": rab_work_order})
	return {
		"columns": columns,
		"result": data,
		"message": message,
		"chart": chart,
		"report_summary": report_summary,
	}


@frappe.whitelist()
def submit_document(doctype: str, name: str):
	"""
	Fetches the document fresh from the database server-side and submits it.

	This avoids TimestampMismatchError: the frontend never passes a potentially-stale
	`modified` timestamp — we always load the canonical record from the DB first.
	"""
	allowed_doctypes = {"RA Bill", "RAB Work Order", "Purchase Invoice", "Payment Entry"}
	if doctype not in allowed_doctypes:
		frappe.throw(
			_("Unsupported doctype: {0}.").format(doctype),
			frappe.PermissionError,
		)

	doc = frappe.get_doc(doctype, name)

	if not frappe.has_permission(doctype, "submit", doc=doc):
		frappe.throw(
			_("You do not have permission to submit {0} {1}.").format(doctype, name),
			frappe.PermissionError,
		)

	if doc.docstatus != 0:
		frappe.throw(
			_("{0} {1} is already submitted (docstatus={2}). Cannot submit again.").format(
				doctype, name, doc.docstatus
			)
		)

	if hasattr(doc, "ensure_child_methods"):
		doc.ensure_child_methods()
	elif doctype in ("RA Bill", "RAB Work Order"):
		for table_field in ("deductions", "additions"):
			for row in getattr(doc, table_field, []):
				if not getattr(row, "method", None):
					row.method = getattr(row, "calculation_method", None) or "Percentage"

	doc.submit()
	return doc.as_dict()


@frappe.whitelist()
def save_document(doc):
	"""
	Saves or updates a document and returns the fresh document dictionary including
	the updated 'modified' timestamp.
	"""
	if isinstance(doc, str):
		doc = frappe.parse_json(doc)
	d = frappe.get_doc(doc)
	d.save()
	return d.as_dict()


@frappe.whitelist()
def get_work_order_advances(work_order: str = None):
	"""
	Returns advances from RAB Work Order Advance child table.
	Child tables cannot be queried via frappe.client.get_list (which throws PermissionError).
	This whitelisted endpoint safely provides access to work order advances.
	"""
	filters = {"parenttype": "RAB Work Order"}
	if work_order:
		filters["parent"] = work_order
	return frappe.get_all(
		"RAB Work Order Advance",
		filters=filters,
		fields=["name", "parent", "advance_type", "description", "amount", "payment_entry"],
		order_by="idx asc",
	)


@frappe.whitelist()
def sync_ra_bill_hold_qty(ra_bill_name: str, invoice_name: str = None):
	"""
	Whitelisted endpoint to recalculate and sync hold_qty and total_hold_value for an RA Bill.
	"""
	from ra_bill.overrides.payment_entry import recalculate_ra_bill_hold_qty
	recalculate_ra_bill_hold_qty(ra_bill_name, invoice_name=invoice_name)
	return {"status": "ok"}

