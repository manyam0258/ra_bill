# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt
"""Idempotent demo / test data for the RA Bill app.

Seeds a construction scenario on the current site: a GST-registered company
address, a customer, a default service item, RA Bill Settings, and a project.
Safe to run multiple times. Used by manual demos and Playwright E2E tests.
"""

import frappe

COMPANY_GSTIN = "24AAACC1206D1ZM"  # valid-format Gujarat GSTIN
HSN_SAC = "995411"  # construction services of residential buildings


def setup_demo(company=None):
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	frappe.flags.ignore_gstin_validation = True

	_ensure_item()
	_ensure_settings()
	company_address = _ensure_company_address(company)
	customer = _ensure_customer()
	supplier = _ensure_subcontractor()
	project = _ensure_project(company)

	frappe.db.commit()
	return {
		"company": company,
		"company_address": company_address,
		"customer": customer,
		"supplier": supplier,
		"project": project,
	}


E2E_USER = "e2e@ra-bill.test"
E2E_PASSWORD = "RaBill@123456"


E2E_ROLES = [
	"System Manager",
	"Site Engineer",
	"Quantity Surveyor",
	"Project Manager",
	"Accounts User",
	"Accounts Manager",
]


def ensure_e2e_user():
	"""Create a dedicated user with all RA roles for Playwright (non-destructive).

	Having every certification role lets a single E2E user walk the whole
	Draft -> Measured -> Checked -> Certified -> Approved workflow.
	"""
	roles = [{"role": r} for r in E2E_ROLES if frappe.db.exists("Role", r)]
	if not frappe.db.exists("User", E2E_USER):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": E2E_USER,
				"first_name": "RA Bill",
				"last_name": "E2E",
				"send_welcome_email": 0,
				"new_password": E2E_PASSWORD,
				"roles": roles,
			}
		)
		user.insert(ignore_permissions=True)
	else:
		user = frappe.get_doc("User", E2E_USER)
		user.new_password = E2E_PASSWORD
		existing = {r.role for r in user.roles}
		for r in roles:
			if r["role"] not in existing:
				user.append("roles", r)
		user.save(ignore_permissions=True)
	frappe.db.commit()
	return E2E_USER


@frappe.whitelist()
def seed_e2e():
	"""Create a fresh project with a Client BOQ and a Subcontractor BOQ for E2E tests.

	Returns the created names so Playwright specs can drive the RA Bill UI against them.
	"""
	base = setup_demo()
	company = base["company"]
	suffix = frappe.generate_hash(length=4)

	project = frappe.get_doc(
		{
			"doctype": "Project",
			"project_name": f"E2E Tower {suffix}",
			"company": company,
			"mobilization_advance": 100000,
			"mobilization_balance": 100000,
			"retention_balance": 0,
		}
	).insert(ignore_permissions=True)

	client_boq = _e2e_boq(
		project.name,
		"Client",
		{"customer": base["customer"]},
		company,
		retention=5,
		tds=2,
		items=[
			{"description": "Earthwork excavation", "uom": "Unit", "boq_qty": 1000, "rate": 300},
			{"description": "RCC M25 concrete", "uom": "Unit", "boq_qty": 500, "rate": 6000},
		],
		mobilization_recovery=20,
		mobilization_advance=100000,
	)
	subcon_boq = _e2e_boq(
		project.name,
		"Subcontractor",
		{"supplier": base["supplier"]},
		company,
		retention=10,
		tds=2,
		items=[
			{"description": "Internal plastering", "uom": "Unit", "boq_qty": 2500, "rate": 180},
			{"description": "External plastering", "uom": "Unit", "boq_qty": 1200, "rate": 220},
		],
	)
	# A subcontractor work order that carries a mobilization advance, so RA bills
	# against it exercise mobilization recovery (capped at the project's balance).
	subcon_mob_boq = _e2e_boq(
		project.name,
		"Subcontractor",
		{"supplier": base["supplier"]},
		company,
		retention=10,
		tds=2,
		mobilization_recovery=15,
		mobilization_advance=100000,
		items=[
			{"description": "Brickwork in superstructure", "uom": "Unit", "boq_qty": 2000, "rate": 250},
			{"description": "Waterproofing", "uom": "Unit", "boq_qty": 800, "rate": 350},
		],
	)
	pct_boq = _e2e_boq(
		project.name,
		"Client",
		{"customer": base["customer"]},
		company,
		retention=5,
		tds=2,
		billing_method="Percentage Completion",
		items=[
			{"description": "Superstructure (milestone)", "uom": "Unit", "boq_qty": 1, "rate": 1000000},
			{"description": "Finishing (milestone)", "uom": "Unit", "boq_qty": 1, "rate": 500000},
		],
	)
	# Measurement Book + approved Variation Order for the subcontractor BOQ,
	# so E2E scenarios can exercise every DocType.
	sub_doc = frappe.get_doc("RAB Work Order", subcon_boq)
	mb = frappe.get_doc(
		{
			"doctype": "Measurement Book",
			"project": project.name,
			"boq": subcon_boq,
			"entries": [
				{
					"boq_item": sub_doc.items[0].name,
					"description": sub_doc.items[0].description,
					"nos": 1,
					"length": 1000,
					"breadth": 1,
					"depth": 1,
				},
				{
					"boq_item": sub_doc.items[1].name,
					"description": sub_doc.items[1].description,
					"nos": 1,
					"length": 500,
					"breadth": 1,
					"depth": 1,
				},
			],
		}
	)
	mb.insert(ignore_permissions=True)
	mb.submit()

	vo = frappe.get_doc(
		{
			"doctype": "Variation Order",
			"project": project.name,
			"boq": subcon_boq,
			"title": "Decorative plaster band",
			"reason": "Client-requested additional finish",
			"items": [
				{
					"item_type": "New Item",
					"description": "Decorative plaster band",
					"uom": "Unit",
					"quantity": 50,
					"rate": 400,
					"pricing_basis": "Negotiated",
				}
			],
		}
	)
	vo.insert(ignore_permissions=True)
	vo.submit()

	frappe.db.commit()
	return {
		"project": project.name,
		"client_boq": client_boq,
		"subcon_boq": subcon_boq,
		"subcon_mob_boq": subcon_mob_boq,
		"pct_boq": pct_boq,
		"subcon_mb": mb.name,
		"subcon_vo": vo.name,
		"customer": base["customer"],
		"supplier": base["supplier"],
	}


def _e2e_boq(
	project,
	boq_type,
	party,
	company,
	items,
	retention,
	tds,
	mobilization_recovery=0,
	mobilization_advance=0,
	billing_method="Item Rate (Measured)",
):
	doc = frappe.get_doc(
		{
			"doctype": "RAB Work Order",
			"project": project,
			"boq_type": boq_type,
			"company": company,
			"billing_method": billing_method,
			"apply_gst": 1,
			"gst_percentage": 18,
			"mobilization_advance_amount": mobilization_advance,
			"items": items,
			"additions": [
				{"addition_type": "Escalation", "method": "Percentage", "rate": 0},
				{"addition_type": "Secured Advance", "method": "Percentage", "rate": 0},
			],
			"deductions": [
				{"deduction_type": "Retention", "method": "Percentage", "rate": retention, "cap_percentage": 0},
				{"deduction_type": "TDS", "method": "Percentage", "rate": tds},
				{"deduction_type": "Labour Cess", "method": "Percentage", "rate": 1},
				{"deduction_type": "Mobilization Recovery", "method": "Percentage", "rate": mobilization_recovery},
			],
			**party,
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc.name


def _ensure_subcontractor():
	name = "Patel Plastering Works"
	if not frappe.db.exists("Supplier", name):
		sg = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"
		doc = frappe.get_doc(
			{
				"doctype": "Supplier",
				"supplier_name": name,
				"supplier_group": sg,
				"supplier_type": "Company",
				"gst_category": "Unregistered",
			}
		)
		# Attach a default TDS section (194C) if one exists, so generated
		# Purchase Invoices apply withholding natively.
		twc = frappe.db.get_value("Tax Withholding Category", {"name": ["like", "%194C%"]}, "name")
		if twc:
			doc.tax_withholding_category = twc
		doc.insert(ignore_permissions=True)
	return name


def _ensure_item():
	if frappe.db.exists("Item", "RA Bill Work"):
		return
	item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"
	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": "RA Bill Work",
			"item_name": "RA Bill Work",
			"item_group": item_group,
			"stock_uom": "Unit",
			"is_stock_item": 0,
			"is_sales_item": 1,
			"is_purchase_item": 1,
			"gst_hsn_code": HSN_SAC,
		}
	).insert(ignore_permissions=True)


def _ensure_settings(company=None):
	company = company or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", limit=1, pluck="name")[0]
	abbr = frappe.get_cached_value("Company", company, "abbr") if company else ""

	settings = frappe.get_single("RA Bill Settings")
	changed = False
	if not settings.default_item:
		settings.default_item = "RA Bill Work"
		changed = True

	def _get_or_create_acc(name, root_type):
		full_name = f"{name} - {abbr}" if abbr else name
		if not frappe.db.exists("Account", full_name):
			parent = frappe.db.get_value("Account", {"company": company, "root_type": root_type, "is_group": 1}, "name")
			if parent:
				acc_type = "Current Asset" if root_type == "Asset" else ""
				frappe.get_doc({
					"doctype": "Account",
					"account_name": name,
					"company": company,
					"parent_account": parent,
					"root_type": root_type,
					"account_type": acc_type,
				}).insert(ignore_permissions=True)
		return full_name if frappe.db.exists("Account", full_name) else None

	if company and abbr:
		for field, (acc_name, root_type) in {
			"retention_payable_account": ("Retention Payable", "Liability"),
			"tds_payable_account": ("TDS Payable", "Liability"),
			"labour_cess_account": ("Labour Cess Payable", "Liability"),
			"mobilization_advance_account": ("Mobilization Advance", "Asset"),
			"advance_recovery_account": ("Advance Recovery", "Asset"),
		}.items():
			if not getattr(settings, field, None):
				acc = _get_or_create_acc(acc_name, root_type)
				if acc:
					setattr(settings, field, acc)
					changed = True

	if changed:
		settings.save(ignore_permissions=True)


def _ensure_company_address(company):
	existing = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Company", "link_name": company, "parenttype": "Address"},
		pluck="parent",
		limit=1,
	)
	if existing:
		return existing[0]
	addr = frappe.get_doc(
		{
			"doctype": "Address",
			"address_title": f"{company} HO",
			"address_type": "Billing",
			"address_line1": "1 Construction House, SG Highway",
			"city": "Ahmedabad",
			"state": "Gujarat",
			"country": "India",
			"pincode": "380015",
			"gstin": COMPANY_GSTIN,
			"gst_category": "Registered Regular",
			"is_your_company_address": 1,
			"links": [{"link_doctype": "Company", "link_name": company}],
		}
	).insert(ignore_permissions=True)
	return addr.name


def _ensure_customer():
	name = "Skyline Developers"
	if not frappe.db.exists("Customer", name):
		cg = frappe.db.get_value("Customer Group", {"is_group": 0}, "name") or "All Customer Groups"
		frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": name,
				"customer_group": cg,
				"territory": "All Territories",
				"gst_category": "Unregistered",
			}
		).insert(ignore_permissions=True)
	return name


def _ensure_project(company):
	name = "Tower-A Construction"
	existing = frappe.db.get_value("Project", {"project_name": name}, "name")
	if existing:
		return existing
	proj = frappe.get_doc(
		{
			"doctype": "Project",
			"project_name": name,
			"company": company,
			"mobilization_advance": 200000,
			"mobilization_balance": 200000,
			"retention_balance": 0,
		}
	).insert(ignore_permissions=True)
	return proj.name
