frappe.ui.form.on("Purchase Invoice", {
	setup(frm) {
		frm.set_df_property("ra_bill_deductions", "read_only", 1);
	},

	refresh(frm) {
		frm.set_df_property("ra_bill_deductions", "read_only", 1);
		if (frm.fields_dict.ra_bill_deductions && frm.fields_dict.ra_bill_deductions.grid) {
			frm.fields_dict.ra_bill_deductions.grid.cannot_add_rows = true;
			frm.fields_dict.ra_bill_deductions.grid.cannot_delete_rows = true;
			frm.fields_dict.ra_bill_deductions.grid.only_sortable();
			frm.fields_dict.ra_bill_deductions.grid.refresh();
		}

		// If Purchase Invoice is submitted and linked to an RA Bill with outstanding balance,
		// provide the manual amount/qty Payment Entry creation flow in Desk.
		if (frm.doc.docstatus === 1 && frm.doc.ra_bill && flt(frm.doc.outstanding_amount) > 0) {
			frm.add_custom_button(__("Create RA Bill Payment Entry"), () => {
				open_ra_bill_payment_entry_dialog(frm);
			}, __("Create"));

			frm.add_custom_button(__("Create RA Bill Payment Entry"), () => {
				open_ra_bill_payment_entry_dialog(frm);
			});
		}
	},
});

function open_ra_bill_payment_entry_dialog(frm) {
	frappe.db.get_doc("RA Bill", frm.doc.ra_bill).then((ra_bill) => {
		frappe.call({
			method: "ra_bill.api.get_linked_payment_entries",
			args: { doctype: "Purchase Invoice", name: frm.doc.name },
			callback: function (res) {
				const pes = res.message || [];
				const has_submitted_pe = pes.some((p) => p.docstatus === 1);

				// Determine effective rate to use for qty <-> amount conversion:
				// If the RA Bill's Hold portion is on a single item row, use that row's actual rate.
				// If Hold is spread across multiple rows, use blended average rate = total_hold_value / total_hold_qty
				// (same existing assumption used for proportional hold_qty reduction).
				const hold_rows = (ra_bill.items || []).filter(
					(r) => flt(r.original_hold_qty || r.hold_qty) > 0
				);
				let effective_rate = 0;
				if (hold_rows.length === 1) {
					effective_rate = flt(hold_rows[0].rate);
				} else if (hold_rows.length > 1) {
					let total_hold_val = flt(ra_bill.total_hold_value || ra_bill.original_total_hold_value);
					let total_hold_q = flt(ra_bill.total_hold_qty || ra_bill.original_total_hold_qty);
					effective_rate = total_hold_q > 0 ? total_hold_val / total_hold_q : flt(hold_rows[0].rate);
				} else if ((ra_bill.items || []).length > 0) {
					effective_rate = flt(ra_bill.items[0].rate);
				}

				const pending_hold_qty = (ra_bill.items || []).reduce((acc, r) => acc + flt(r.hold_qty), 0);
				const pending_hold_val = flt(ra_bill.total_hold_value);

				const outstanding = flt(frm.doc.outstanding_amount);
				let default_amount = outstanding;

				if (!has_submitted_pe) {
					let gross = flt(ra_bill.gross_work_value);
					let hold = flt(ra_bill.total_hold_value);
					let net = flt(ra_bill.net_payable);
					if (gross > 0 && hold > 0 && net > 0) {
						let hold_fraction = hold / gross;
						let imm_payable = Math.round(Math.max(0, net * (1.0 - hold_fraction)) * 100) / 100;
						default_amount = Math.min(imm_payable, outstanding);
					}
				}

				const default_qty =
					effective_rate > 0 && default_amount > 0
						? Math.round((default_amount / effective_rate) * 100) / 100
						: 0;

				const max_allowed_qty =
					has_submitted_pe && pending_hold_qty > 0
						? pending_hold_qty
						: effective_rate > 0
						? Math.round((outstanding / effective_rate) * 100) / 100
						: 0;

				const dialog = new frappe.ui.Dialog({
					title: __("Create RA Bill Payment Entry"),
					fields: [
						{
							fieldname: "info_html",
							fieldtype: "HTML",
							options: `
								<div style="background: var(--bg-light-gray, #f8f9fa); padding: 12px 16px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; border: 1px solid var(--border-color, #e2e8f0);">
									<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
										<span><b>Linked RA Bill:</b> ${ra_bill.name}</span>
										<span><b>Outstanding:</b> ${format_currency(outstanding, frm.doc.currency)}</span>
									</div>
									${
										pending_hold_qty > 0
											? `
									<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
										<span><b>Pending Hold Qty:</b> <span style="color: #d97706; font-weight: 600;">${pending_hold_qty} units</span></span>
										<span><b>Pending Hold Value:</b> <span style="color: #d97706; font-weight: 600;">${format_currency(pending_hold_val, frm.doc.currency)}</span></span>
									</div>`
											: ""
									}
									${
										!has_submitted_pe && pending_hold_qty > 0
											? `
									<div class="text-muted small" style="margin-top: 6px;">
										Default is immediately-payable amount. The remaining hold portion (${pending_hold_qty} pending) can be paid in later Payment Entries.
									</div>`
											: ""
									}
								</div>
							`,
						},
						{
							fieldname: "qty_to_pay",
							fieldtype: "Float",
							label:
								__("Qty to Pay") + (pending_hold_qty > 0 ? ` (${pending_hold_qty} pending)` : ""),
							default: default_qty,
							description:
								effective_rate > 0
									? `Effective Rate: ${format_currency(effective_rate, frm.doc.currency)}`
									: "",
						},
						{
							fieldtype: "Column Break",
						},
						{
							fieldname: "amount_to_pay",
							fieldtype: "Currency",
							label: __("Amount to Pay"),
							reqd: 1,
							default: default_amount,
							options: "Company:company:default_currency",
						},
						{
							fieldtype: "Section Break",
						},
						{
							fieldname: "mode_of_payment",
							fieldtype: "Link",
							label: __("Mode of Payment"),
							options: "Mode of Payment",
							reqd: 1,
						},
						{
							fieldname: "paid_from",
							fieldtype: "Link",
							label: __("Paid From Account"),
							options: "Account",
							get_query: () => ({
								filters: {
									company: frm.doc.company,
									is_group: 0,
									account_type: ["in", ["Bank", "Cash"]],
								},
							}),
						},
						{
							fieldtype: "Column Break",
						},
						{
							fieldname: "posting_date",
							fieldtype: "Date",
							label: __("Posting Date"),
							reqd: 1,
							default: frappe.datetime.nowdate(),
						},
						{
							fieldname: "reference_no",
							fieldtype: "Data",
							label: __("Reference No (Cheque / UTR)"),
							default: `PAY-${frm.doc.name}`,
						},
						{
							fieldname: "reference_date",
							fieldtype: "Date",
							label: __("Reference Date"),
							default: frappe.datetime.nowdate(),
						},
					],
					primary_action_label: __("Create Payment Entry"),
					primary_action: function (values) {
						const amt = flt(values.amount_to_pay);
						const qty = flt(values.qty_to_pay);

						if (amt <= 0) {
							frappe.msgprint({
								title: __("Validation Error"),
								indicator: "red",
								message: __("Amount to Pay must be greater than 0."),
							});
							return;
						}

						if (amt > outstanding + 0.005) {
							frappe.msgprint({
								title: __("Validation Error"),
								indicator: "red",
								message: __("Amount to Pay cannot exceed remaining outstanding ({0}).", [
									format_currency(outstanding, frm.doc.currency),
								]),
							});
							return;
						}

						if (effective_rate > 0 && qty > max_allowed_qty + 0.005) {
							frappe.msgprint({
								title: __("Validation Error"),
								indicator: "red",
								message: __(
									"Qty to Pay cannot exceed {0}.",
									[
										has_submitted_pe && pending_hold_qty > 0
											? `pending hold qty (${pending_hold_qty})`
											: `maximum allowed qty (${max_allowed_qty})`,
									]
								),
							});
							return;
						}

						frappe.call({
							method: "ra_bill.api.create_payment_entry_from_invoice",
							args: {
								invoice_name: frm.doc.name,
								reference_no: (values.reference_no || "").trim() || `PAY-${frm.doc.name}`,
								reference_date: values.reference_date || frappe.datetime.nowdate(),
								mode_of_payment: values.mode_of_payment,
								paid_from: values.paid_from,
								custom_amount: amt,
								auto_submit: 0,
							},
							freeze: true,
							freeze_message: __("Creating Payment Entry..."),
							callback: function (r) {
								dialog.hide();
								if (r.message && r.message.payment_entry) {
									frappe.show_alert({
										message: __("Draft Payment Entry {0} created", [r.message.payment_entry]),
										indicator: "green",
									});
									frappe.set_route("Form", "Payment Entry", r.message.payment_entry);
								}
							},
						});
					},
				});

				// Two-way sync between Qty to Pay and Amount to Pay
				let in_sync = false;
				dialog.fields_dict.qty_to_pay.$input.on("input", function () {
					if (in_sync) return;
					in_sync = true;
					let q = flt(dialog.get_value("qty_to_pay"));
					if (effective_rate > 0) {
						let amt = Math.round(q * effective_rate * 100) / 100;
						dialog.set_value("amount_to_pay", amt);
					}
					in_sync = false;
				});

				dialog.fields_dict.amount_to_pay.$input.on("input", function () {
					if (in_sync) return;
					in_sync = true;
					let amt = flt(dialog.get_value("amount_to_pay"));
					if (effective_rate > 0) {
						let q = Math.round((amt / effective_rate) * 100) / 100;
						dialog.set_value("qty_to_pay", q);
					}
					in_sync = false;
				});

				// Auto-populate default Mode of Payment & Account
				frappe.call({
					method: "frappe.client.get_list",
					args: { doctype: "Mode of Payment", fields: ["name", "type"], limit: 50 },
					callback: function (mopRes) {
						const mops = mopRes.message || [];
						const cashMop = mops.find((m) => m.type === "Cash");
						const defaultMop = cashMop || mops[0];
						if (defaultMop) {
							dialog.set_value("mode_of_payment", defaultMop.name);
							frappe.call({
								method: "ra_bill.api.get_default_payment_account",
								args: { mode_of_payment: defaultMop.name, company: frm.doc.company },
								callback: function (accRes) {
									if (accRes.message && accRes.message.account) {
										dialog.set_value("paid_from", accRes.message.account);
									}
								},
							});
						}
					},
				});

				dialog.fields_dict.mode_of_payment.df.onchange = function () {
					let mop = dialog.get_value("mode_of_payment");
					if (mop) {
						frappe.call({
							method: "ra_bill.api.get_default_payment_account",
							args: { mode_of_payment: mop, company: frm.doc.company },
							callback: function (accRes) {
								if (accRes.message && accRes.message.account) {
									dialog.set_value("paid_from", accRes.message.account);
								}
							},
						});
					}
				};

				dialog.show();
			},
		});
	});
}
