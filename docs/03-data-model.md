# RA Bill — Data Model

Module: **RA Bill** · App: `ra_bill`

## DocType overview
| DocType | Type | Purpose |
|---|---|---|
| RA Bill Settings | Single | Default service item, default GL accounts |
| BOQ | Submittable master | Priced contract schedule (Bill of Quantities) |
| BOQ Item | Child | BOQ line: description, uom, qty, rate |
| Measurement Book | Submittable | Site measurement record feeding RA bills |
| Measurement Entry | Child | nos × L × B × D measurement detail |
| Variation Order | Submittable | Approved scope changes / extra items |
| Variation Order Item | Child | VO line: type, qty change, rate, pricing basis |
| RA Bill | Submittable txn | Cumulative progressive bill |
| RA Bill Item | Child | cumulative/previous/current qty (+ % methods) engine |
| RA Bill Deduction | Child | other deductions (LD, defective, material, water/elec) |
| RA Bill Secured Advance | Child | CPWD Part II — materials at site, reduced rate |
| RA Bill Escalation | Child | index-based price escalation lines |

## Connections (form dashboards)
- **BOQ** → RA Bill, Variation Order (via `boq`), Measurement Book (via `boq`)
- **RA Bill** → Sales Invoice, Purchase Invoice (via custom `ra_bill` field)
- **Measurement Book** → RA Bill (via `measurement_book`)

## Variation Order
Header: `project`, `boq`, `initiated_by`, `vo_date`, `time_impact_days`, `title`, `reason`,
`status`(Draft/Approved/Rejected/Executed), `cost_impact`(RO), `items`(Table). On submit → Approved.
`get_variation_items(boq)` returns approved VO lines as RA Bill extra items.

## RA Bill — added fields
`measurement_book`(Link) · `billing_method` · `escalations`(Table) + `escalation_amount` ·
`billable_value`(= gross + escalation; taxable base) · `secured_advances`(Table) +
`secured_advance_current`/`secured_advance_previous`/`secured_advance_adjustment`.
RA Bill Item adds `variation_order`(Link) and `cumulative_percent`/`previous_percent`/`current_percent`/`contract_amount`.

## BOQ
Header: `project`(Link Project, reqd) · `boq_type`(Select: Client/Subcontractor) · `customer`(Link) · `supplier`(Link) · `company`(Link, reqd) · `currency` · `contract_date` · `contract_value`(Currency) · `retention_percentage` · `mobilization_advance_amount` · `mobilization_recovery_percentage` · `labour_cess_percentage`(default 1) · `tds_percentage`(default 2) · `apply_gst`(Check) · `gst_percentage`(default 18) · `defect_liability_period_days` · `total_boq_amount`(RO) · `items`(Table BOQ Item) · `status`(Draft/Active/Closed).
Naming: `naming_series` = `BOQ-.YYYY.-`. Controller: compute `amount` per item & `total_boq_amount`.

## BOQ Item (istable)
`item_code`(Link Item) · `description`(Small Text, reqd) · `uom`(Link UOM) · `boq_qty`(Float, reqd) · `rate`(Currency, reqd) · `amount`(Currency, RO) · `cost_code`(Data).

## RA Bill
Header: `naming_series`(`RA-.YYYY.-`) · `project`(reqd) · `boq`(Link BOQ, reqd) · `bill_type`(fetch) · `customer`/`supplier`(fetch) · `company`(fetch) · `cost_center`(Link) · `posting_date`(default today) · `ra_bill_no`(Int, sequence per project) · `previous_ra_bill`(Link RA Bill) · `is_final_bill`(Check) · `items`(Table RA Bill Item).
Amounts (all RO, computed): `gross_work_value`(Σ current_amount) · `previous_billed_value`(Σ previous_amount) · `cumulative_work_value` · `labour_cess_percentage`/`labour_cess_amount` · `apply_gst`/`gst_percentage`/`gst_amount` · `total_invoice_value`(gross+cess+gst).
Deductions: `retention_percentage`/`retention_amount` · `tds_percentage`/`tds_amount` · `mobilization_recovery_percentage`/`mobilization_recovery_amount` · `deductions`(Table) · `other_deductions_total` · `total_deductions` · `net_payable`.
Linking: `sales_invoice`(RO) · `purchase_invoice`(RO) · `remarks` · `workflow_state`.

### Computation (controller `validate`)
```
for each item: current_qty = cumulative_qty − previous_qty
               current_amount = current_qty × rate
gross_work_value      = Σ current_amount
previous_billed_value = Σ previous_amount
cumulative_work_value = gross_work_value + previous_billed_value
labour_cess_amount    = labour_cess_percentage % × gross_work_value
gst_amount            = apply_gst ? gst_percentage % × (gross_work_value + labour_cess_amount) : 0
total_invoice_value   = gross_work_value + labour_cess_amount + gst_amount
retention_amount      = retention_percentage % × gross_work_value
tds_amount            = tds_percentage % × gross_work_value
mobilization_recovery_amount = min(mobilization_recovery_percentage % × gross_work_value, advance_balance)
other_deductions_total = Σ deductions.amount
total_deductions      = retention + tds + cess + mobilization_recovery + other
net_payable           = total_invoice_value − total_deductions
```
`previous_qty` per item is auto-fetched from `previous_ra_bill` item with matching `boq_item` (else 0).

## RA Bill Item (istable)
`boq_item`(Data hidden, BOQ Item rowname) · `item_code`(Link Item) · `description`(Small Text, reqd) · `uom`(Link UOM) · `rate`(Currency) · `boq_qty`(Float) · `cumulative_qty`(Float) · `previous_qty`(Float, RO) · `current_qty`(Float, RO) · `previous_amount`(RO) · `current_amount`(RO) · `cumulative_amount`(RO) · `deviation_qty`(RO = cumulative−boq_qty) · `is_extra_item`(Check).

## RA Bill Deduction (istable)
`deduction_type`(Select: Secured Advance Recovery/Client Material Recovery/Liquidated Damages/Defective Work/Other) · `description`(Data) · `account`(Link Account) · `amount`(Currency, reqd).

## Measurement Book / Measurement Entry
MB: `project` · `boq` · `measurement_date` · `ra_bill`(Link, optional) · `entries`(Table) · `remarks`.
Entry: `boq_item`(Data) · `description` · `uom` · `nos`(Float) · `length` · `breadth` · `depth` · `quantity`(Float = nos×L×B×D, RO).

## Custom fields (created in after_install)
- **Sales Invoice / Purchase Invoice**: `ra_bill`(Link RA Bill, RO, no_copy, allow_on_submit).
- **Project**: `ra_bill_section`(Section Break) · `boq`(Link BOQ) · `contract_value`(Currency) · `retention_percentage`(Percent) · `mobilization_advance`(Currency) · `mobilization_balance`(Currency, RO) · `retention_balance`(Currency, RO).

## Posting to accounting (explicit action, not forced on submit)
RA Bill `on_submit` → updates Project `mobilization_balance` / `retention_balance`, locks bill.
Button **Create Sales Invoice** (client) / **Create Purchase Invoice** (subcontract) → whitelisted method generates a **standard** invoice: one line per item (item_code or Settings default item), qty=current_qty, rate=rate; sets project/cost_center; back-links `ra_bill`. GST/TDS handled by india_compliance on the standard invoice. Retention via Payment Entry deduction / JE (documented; phase 2 automation).
