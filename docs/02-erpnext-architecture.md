# RA Bill → ERPNext v15 Architecture

> How the RA Bill process maps onto ERPNext, what we reuse, what we build, and why.

## Core decision
**RA Bill is a standalone, submittable DocType that GENERATES a standard Sales Invoice (client) / Purchase Invoice (subcontractor). Do NOT subclass Sales Invoice.**

Why:
1. **Cumulative vs additive impedance** — RA bills restate cumulative work and subtract prior bills; ERPNext invoices are additive. The previous-qty / this-qty columns + `previous_ra_bill` chain have no home on Sales Invoice.
2. **Don't fork the accounting engine** — india_compliance applies GST/TDS to *standard* SI/PI via `doc_events` (NOT subclassing; it only class-overrides "Customize Form"). Generating a normal SI/PI inherits **GST + cumulative TDS automatically**.
3. **Domain concerns** (MB, deviation, retention/advance, certification) would pollute Sales Invoice.
4. **Separation**: RA Bill = certified measurement document; SI/PI = the financial posting it spawns.

## Reused ERPNext building blocks (verified on disk)
- **Project** (`erpnext/projects/doctype/project`) — site/contract container: `customer`, `cost_center`, roll-ups `total_billed_amount`, `total_sales_amount`. (`percent_complete` is task-driven, NOT a billing measure — don't reuse for billing progress.)
- **Sales Order / SO Item** — contract/BOQ substrate. `SO Item.billed_amt` (running total), SO `per_billed`, `billing_status`.
- **Sales Invoice / SI Item** — progressive bill engine. **`SI Item.sales_order` + `so_detail`** drive `billed_amt`/`per_billed` roll-ups (`erpnext/controllers/selling_controller.py`). SI `project`, `payment_schedule`, `advances`.
- **Purchase Order / Purchase Invoice** — subcontractor RA bills. **`PI Item.purchase_order` + `po_detail`** → `billed_amt`/`per_billed`. PI `apply_tds` + `tax_withholding_category`.
- **Payment Entry** — `references` (advances against SO/PO), **`deductions` (Payment Entry Deduction: account/cost_center/amount)** — native retention holdback at payment. `apply_tax_withholding_amount` — TDS at payment. `set_total_advance_paid` → `advance_paid`.
- **Journal Entry** — generic retention release / advance reclass; child supports `party`, `project`, `is_advance`, `reference_type/name`.
- **Payment Terms / Payment Schedule** — staged release split (schedule only, no GL to retention account).
- **Tax templates** — `Sales/Purchase Taxes and Charges`: `charge_type` (On Net Total etc.), `account_head`, `rate`. **Purchase has `add_deduct_tax` (Add/Deduct)** → retention as deduct-tax row on subcontract PI. **Sales has NO `add_deduct_tax`** → client retention via Payment Entry deduction / Journal Entry.
- **india_compliance** — TDS via `Tax Withholding Category` (cumulative across PAN/FY; `set_tax_withholding()` adds Actual/Deduct row — **threshold considers prior bills automatically**). GST via `doc_events` (`before_validate_transaction`, `update_gst_details`) selecting CGST+SGST / IGST by place of supply.

## Gaps — must be custom-built
| RA Bill concept | Native? | Our solution |
|---|---|---|
| BOQ as first-class versioned object | No | **BOQ + BOQ Item** DocTypes |
| Cumulative measurement (this = cumulative − previous) | No | **RA Bill Item** with `cumulative_qty`/`previous_qty`/`current_qty` |
| Measurement Book | No | **Measurement Book + Measurement Entry** |
| Retention as first-class | No | RA Bill fields + JE/PE deduction posting |
| Mobilization advance + recovery schedule | No | BOQ/Project fields + per-bill scripted recovery |
| RA Bill certification workflow | No | Frappe Workflow on RA Bill |
| Deviation/variation statement | No | RA Bill Item `deviation_qty` + report |

## Our DocTypes (see `03-data-model.md`)
**Masters:** BOQ (+ BOQ Item). **Measurement:** Measurement Book (+ Measurement Entry). **Transaction:** RA Bill (+ RA Bill Item, RA Bill Deduction).
**Custom fields:** Project (contract_value, retention_percentage, mobilization_advance, advance_balance, boq), Sales Invoice / Purchase Invoice (`ra_bill` back-link).

## How RA Bill posts to accounting
1. On submit / "Create Invoice": generate standard **Sales Invoice** (client) or **Purchase Invoice** (subcontract), one line per RA Bill item, carrying `sales_order`/`so_detail` (or `purchase_order`/`po_detail`) so native roll-ups stay correct; set `project`, `cost_center`, back-link `ra_bill`.
2. **GST**: automatic via india_compliance hooks.
3. **TDS** (subcontract PI): set `apply_tds=1` + `tax_withholding_category` (194C) → cumulative Actual/Deduct row.
4. **Retention**: subcontract → Purchase Taxes deduct row to "Retention Payable"; client → Payment Entry deduction / JE to "Retention Receivable".
5. **Mobilization recovery**: scripted deduction line each bill against advance liability until zero; reduce `Project.advance_balance`.
6. **Retention release** (DLP end): Journal Entry.

## Hooks (`ra_bill/hooks.py`)
- `doc_events` on **RA Bill**: `validate` (cumulative + deductions + totals), `on_submit` (generate/link invoice; update advance balance), `on_cancel` (cancel/unlink invoice, restore balances).
- **No class override of SI/PI** — generate standard invoices so erpnext roll-ups + india_compliance GST/TDS fire naturally.
- Frappe Workflow on RA Bill: Draft → Measured → Checked → Certified → Approved → Invoiced.
- Print formats (RA Bill abstract, deviation, measurement sheet); reports (RA register, retention ledger, advance recovery, BOQ vs billed).
- Roles: Site Engineer, Quantity Surveyor, Project Manager, Accounts User.

## Reference open-source apps (read only, don't depend on)
- `Zaryab03/construction_management_suite` (BOQ/IPC/Retention; immature)
- `revant/civil_contracting` (RA Bill chained via `prev_ra_bill`, MB; abandoned, pre-v15)
