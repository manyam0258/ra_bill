# Features & Native Integration

> How the app stays generic across construction/real-estate workflows, and how it leans on
> native ERPNext / India Compliance / Frappe instead of reinventing tax & deduction logic.
> Reconciles this repo's research (`01`/`02`) with the user's CPWD-grade knowledgebase
> (`/home/surendhra/Running_Account_Billing_Knowledgebase.md`).

## 1. Generic across billing methods (one engine)
The RA Bill engine supports four billing methods, selected on the **BOQ** (`billing_method`) and inherited by every RA Bill:

| Method | How "this bill" value is computed | Covers |
|---|---|---|
| **Item Rate (Measured)** | (cumulative_qty − previous_qty) × rate | CPWD/PWD item-rate, infra, civil, **area-based** (unit = sq.ft) |
| **Percentage Completion** | (cumulative% − previous%) × line contract amount | EPC, design-build, progress billing |
| **Milestone** | each line = a milestone; % complete (0/partial/100) × milestone value | real-estate milestone schedules |
| **Lump Sum** | single/few lines; % complete × lump-sum value | lump-sum contracts |

`contract_amount` per line = BOQ qty × rate is the base for the %-based methods. Cumulative is always the running source of truth; "this bill" = cumulative − previous (qty or %).

## 2. Generic deductions & recoveries
- **First-class fields** (common to every bill): retention, income-tax TDS, labour cess, mobilization advance recovery.
- **`RA Bill Deduction` child table** for everything else, each with its own GL account: Secured Advance Recovery, Client Material Recovery, Liquidated Damages, Defective Work, Water/Electricity, Other. New deduction types need no code change.
- **Retention cap**: cumulative retention is capped at `retention_cap_percentage` × contract value (CPWD "5% of contract value" rule). Set cap to 0 to disable.
- **Recovery / negative bills**: cumulative may move *down* (re-measurement correction or milestone reversal), producing a negative "this bill" value — supported (KB Scenario 1).
- **Deviation tolerance**: a soft warning fires when cumulative qty exceeds BOQ qty beyond `deviation_tolerance_percentage` (default 25%) and the line isn't flagged `is_extra_item` — prompting a Variation Order, without blocking.

## 3. Native integration (do NOT reinvent)
| Concern | Native mechanism used | Where |
|---|---|---|
| **GST (CGST/SGST/IGST)** | ERPNext **Sales/Purchase Taxes & Charges Template** + India Compliance `doc_events`. The app auto-selects `Output GST In-state`/`Out-state - {abbr}` by place of supply and expands it onto the generated invoice. | `_gst_sales_template`, `_apply_tax_template` |
| **Income-tax TDS (194C)** on subcontractor bills | ERPNext **Tax Withholding Category** (cumulative across PAN/FY) via `apply_tds=1` on the generated **Purchase Invoice** — threshold logic considers prior bills automatically. | `_make_purchase_invoice` |
| **Place of supply / GSTIN** | India Compliance, via company/party **Address** + GSTIN. The app sets `company_address`/`customer_address`/`supplier_address`. | `_company_address`, `_party_address` |
| **Accounting postings (GL, AR/AP)** | The RA Bill **generates a standard Sales/Purchase Invoice** — all GL, outstanding, and party-ledger postings are ERPNext's. | `make_invoice` |
| **Advances** | Mobilization tracked as a running balance on **Project**; can also be paid via native **Payment Entry** advance against SO/PO. | controller + Project custom fields |
| **Retention posting** | Subcontract: native Purchase Taxes "Deduct" row to a Retention Payable account. Client: native **Payment Entry deduction** / Journal Entry to Retention Receivable. (Configurable in **RA Bill Settings**.) | documented; phase-2 auto-posting |
| **Roles / workflow / permissions** | Frappe **Role**, **Workflow**, DocPerm. | `setup.py` |

On the **contractor/client RA bill (Sales Invoice)** the income-tax TDS is a *memorandum* deduction (the client deducts it on payment, not the contractor on the invoice) — shown on the bill for the expected-receipt calculation. GST TDS (Sec 51) is likewise a memorandum line where applicable.

## 4. What the app adds (not native)
BOQ (versioned, billing-method aware), cumulative **RA Bill** + measurement engine, **Measurement Book**, retention/advance running balances & caps, certification **Workflow**, RA Bill register & abstract reports, CPWD-style memorandum print format.

## 5. Mapped from the user's KB → status
| KB concept | Status in app |
|---|---|
| BOQ + items, revisions | ✅ BOQ submittable + amend |
| Measurement Book (no×L×B×D) | ✅ Measurement Book + Entry |
| RA Bill 3-part memorandum | ✅ controller + print format |
| Retention + cap | ✅ |
| Mobilization advance recovery | ✅ (running balance) |
| Secured advance (materials at site) | ✅ `RA Bill Secured Advance` (reduced rate, auto-recovery, Project balance) |
| Variation Order / extra items | ✅ `Variation Order` (+ items); pulled into RA Bill as extra items |
| Contract types (item/%/lump/milestone) | ✅ billing_method |
| Subcontractor RA (PI + native TDS) | ✅ |
| GST / TDS / labour cess | ✅ native GST + TDS, custom cess |
| Price escalation | ✅ `RA Bill Escalation` (index-based, into billable base) |
| Equipment advance | ◯ phase 2 (model like secured advance) |
| Material reconciliation / WIP / EVM | ◯ phase 2 (leverage ERPNext Stock + Project costing) |
| Reports: register, abstract | ✅ (advance tracking, cost-to-complete = phase 2) |

Legend: ✅ done · ◑ partial/usable · ◯ planned
