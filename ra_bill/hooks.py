app_name = "ra_bill"
app_title = "RA Bill"
app_publisher = "Surendhra"
app_description = "Running Account Bill (progressive construction billing) for ERPNext — work orders, measurement, cumulative RA bills, retention, advances, certification workflow."
app_email = "surendhra.erpnext@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "ra_bill",
		"title": "RA Bill",
		"route": "/ra_bill",
		"logo": "/assets/ra_bill/images/logo.png",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/ra_bill/css/ra_bill.css"
# app_include_js = "/assets/ra_bill/js/ra_bill.js"

# include js, css files in header of web template
# web_include_css = "/assets/ra_bill/css/ra_bill.css"
# web_include_js = "/assets/ra_bill/js/ra_bill.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "ra_bill/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
    "Payment Entry": "public/js/payment_entry.js",
    "Purchase Invoice": "public/js/purchase_invoice.js"
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "ra_bill/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "ra_bill.utils.jinja_methods",
# 	"filters": "ra_bill.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "ra_bill.install.before_install"
after_install = "ra_bill.setup.after_install"

# Migration
# ---------
before_migrate = "ra_bill.setup.before_migrate"
after_migrate = "ra_bill.setup.after_migrate"

# Uninstallation
# ------------

# before_uninstall = "ra_bill.uninstall.before_uninstall"
# after_uninstall = "ra_bill.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "ra_bill.utils.before_app_install"
# after_app_install = "ra_bill.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "ra_bill.utils.before_app_uninstall"
# after_app_uninstall = "ra_bill.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "ra_bill.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
    "Payment Entry": "ra_bill.overrides.payment_entry.CustomPaymentEntry"
}

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Purchase Invoice": {
		"validate": "ra_bill.api.purchase_invoice.sync_ra_bill_deductions"
	}
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"ra_bill.tasks.all"
# 	],
# 	"daily": [
# 		"ra_bill.tasks.daily"
# 	],
# 	"hourly": [
# 		"ra_bill.tasks.hourly"
# 	],
# 	"weekly": [
# 		"ra_bill.tasks.weekly"
# 	],
# 	"monthly": [
# 		"ra_bill.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "ra_bill.install.before_tests"

# Overriding Methods
# ------------------------------
#
override_whitelisted_methods = {
    "erpnext.accounts.doctype.payment_entry.payment_entry.get_reference_details":
        "ra_bill.api.payment_entry.get_reference_details",
    "erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry":
        "ra_bill.api.payment_entry.get_payment_entry",
}
# 	"frappe.desk.doctype.event.event.get_events": "ra_bill.event.get_events"

#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "ra_bill.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["ra_bill.utils.before_request"]
# after_request = ["ra_bill.utils.after_request"]

# Job Events
# ----------
# before_job = ["ra_bill.utils.before_job"]
# after_job = ["ra_bill.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"ra_bill.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


website_route_rules = [{'from_route': '/frontend/<path:app_path>', 'to_route': 'frontend'},]