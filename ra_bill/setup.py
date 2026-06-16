# Copyright (c) 2026, Surendhra and contributors
# For license information, please see license.txt
"""Install / migrate setup for the RA Bill app.

Roles must exist *before* DocType permissions are synced, so they are created in
`before_migrate`. Custom fields and the certification workflow reference the app's
DocTypes, so they are (idempotently) created in `after_migrate`.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

RA_ROLES = ["Site Engineer", "Quantity Surveyor", "Project Manager", "Accounts User"]


def before_migrate():
	ensure_roles()


def after_migrate():
	ensure_roles()
	setup_custom_fields()
	setup_workflow()


def after_install():
	ensure_roles()
	setup_custom_fields()
	setup_workflow()


# --------------------------------------------------------------------------- #
# Roles
# --------------------------------------------------------------------------- #
def ensure_roles():
	for role in RA_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc(
				{"doctype": "Role", "role_name": role, "desk_access": 1}
			).insert(ignore_permissions=True)


# --------------------------------------------------------------------------- #
# Custom fields on standard DocTypes
# --------------------------------------------------------------------------- #
def setup_custom_fields():
	custom_fields = {
		"Sales Invoice": [
			{
				"fieldname": "ra_bill",
				"label": "RA Bill",
				"fieldtype": "Link",
				"options": "RA Bill",
				"insert_after": "project",
				"read_only": 1,
				"no_copy": 1,
				"allow_on_submit": 1,
				"print_hide": 1,
			}
		],
		"Purchase Invoice": [
			{
				"fieldname": "ra_bill",
				"label": "RA Bill",
				"fieldtype": "Link",
				"options": "RA Bill",
				"insert_after": "project",
				"read_only": 1,
				"no_copy": 1,
				"allow_on_submit": 1,
				"print_hide": 1,
			}
		],
		"Project": [
			{
				"fieldname": "ra_bill_section",
				"label": "RA Bill / Contract",
				"fieldtype": "Section Break",
				"insert_after": "cost_center",
				"collapsible": 1,
			},
			{
				"fieldname": "boq",
				"label": "Work Order",
				"fieldtype": "Link",
				"options": "RAB Work Order",
				"insert_after": "ra_bill_section",
			},
			{
				"fieldname": "contract_value",
				"label": "Contract Value",
				"fieldtype": "Currency",
				"insert_after": "boq",
			},
			{
				"fieldname": "retention_percentage",
				"label": "Retention %",
				"fieldtype": "Percent",
				"insert_after": "contract_value",
			},
			{
				"fieldname": "ra_bill_col_break",
				"fieldtype": "Column Break",
				"insert_after": "retention_percentage",
			},
			{
				"fieldname": "mobilization_advance",
				"label": "Mobilization Advance",
				"fieldtype": "Currency",
				"insert_after": "ra_bill_col_break",
			},
			{
				"fieldname": "mobilization_balance",
				"label": "Mobilization Advance Balance",
				"fieldtype": "Currency",
				"insert_after": "mobilization_advance",
				"read_only": 1,
				"description": "Outstanding advance still to be recovered from RA Bills",
			},
			{
				"fieldname": "retention_balance",
				"label": "Retention Held Balance",
				"fieldtype": "Currency",
				"insert_after": "mobilization_balance",
				"read_only": 1,
			},
			{
				"fieldname": "secured_advance_balance",
				"label": "Secured Advance Outstanding",
				"fieldtype": "Currency",
				"insert_after": "retention_balance",
				"read_only": 1,
			},
		],
	}
	create_custom_fields(custom_fields, ignore_validate=True)


# --------------------------------------------------------------------------- #
# Certification workflow
# --------------------------------------------------------------------------- #
def setup_workflow():
	workflow_name = "RA Bill Certification"
	if frappe.db.exists("Workflow", workflow_name):
		return

	states = [
		("Draft", 0, "Site Engineer", "danger"),
		("Measured", 0, "Site Engineer", "warning"),
		("Checked", 0, "Quantity Surveyor", "info"),
		("Certified", 0, "Project Manager", "primary"),
		("Approved", 1, "Project Manager", "success"),
		("Cancelled", 2, "Quantity Surveyor", "dark"),
	]
	transitions = [
		("Draft", "Submit for Measurement", "Measured", "Site Engineer"),
		("Measured", "Check", "Checked", "Quantity Surveyor"),
		("Checked", "Certify", "Certified", "Project Manager"),
		("Certified", "Approve", "Approved", "Project Manager"),
		("Measured", "Reject", "Draft", "Quantity Surveyor"),
		("Checked", "Reject", "Draft", "Quantity Surveyor"),
		("Certified", "Reject", "Draft", "Project Manager"),
	]

	# Ensure Workflow State + Action master records exist.
	for state, docstatus, *_ in states:
		if not frappe.db.exists("Workflow State", state):
			frappe.get_doc({"doctype": "Workflow State", "workflow_state_name": state}).insert(
				ignore_permissions=True
			)
	for t in transitions:
		action = t[1]
		if not frappe.db.exists("Workflow Action Master", action):
			frappe.get_doc(
				{"doctype": "Workflow Action Master", "workflow_action_name": action}
			).insert(ignore_permissions=True)

	wf = frappe.get_doc(
		{
			"doctype": "Workflow",
			"workflow_name": workflow_name,
			"document_type": "RA Bill",
			"is_active": 1,
			"override_status": 0,
			"send_email_alert": 0,
			"workflow_state_field": "workflow_state",
			"states": [
				{
					"state": s[0],
					"doc_status": s[1],
					"allow_edit": s[2],
					"style": s[3],
				}
				for s in states
			],
			"transitions": [
				{
					"state": t[0],
					"action": t[1],
					"next_state": t[2],
					"allowed": t[3],
					"allow_self_approval": 1,
				}
				for t in transitions
			],
		}
	)
	wf.insert(ignore_permissions=True)
