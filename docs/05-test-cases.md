# RA Bill — Process Walkthrough & Test Cases

This document explains **how the RA Bill process works end-to-end** in the app and records
**every automated test case** (backend unit tests + Playwright E2E) with expected results.

---

## 1. The process, end to end

```
Project
  └── BOQ (Bill of Quantities)            ← contract: items, rates, terms (retention, advances, GST, TDS, cess)
        ├── Measurement Book (MB)         ← site measurements (no × L × B × D) per BOQ item
        ├── Variation Order (VO)          ← approved extra / changed items
        └── RA Bill 1 … RA Bill N         ← cumulative interim bills
              ├── Items (cumulative − previous = this bill)
              ├── Price Escalation        ← index-based, adds to billable value
              ├── Secured Advance         ← materials at site (reduced rate), added then recovered
              ├── Deductions              ← retention, TDS, cess, mobilization recovery, others
              ├── Certification Workflow  ← Draft → Measured → Checked → Certified → Approved
              └── Sales / Purchase Invoice ← posts to accounts (GST + TDS native)
```

### Calculation (per bill)
```
this_bill_amount(item) = (cumulative − previous) × rate            # Item Rate
                       = (cumulative% − previous%) × line value     # Percentage / Milestone / Lump Sum
gross_work_value       = Σ this_bill_amount
escalation_amount      = Σ (current_index − base_index)/base_index × qty × base_rate × share%
billable_value         = gross_work_value + escalation_amount       # taxable base
labour_cess            = cess% × billable_value
GST                    = gst% × (billable_value + labour_cess)      # cess in GST base (Sec 15(2)(a))
total_invoice_value    = billable_value + labour_cess + GST
retention              = min(retention% × billable_value, cap − already_held)
TDS (194C)             = tds% × billable_value
mobilization_recovery  = min(recovery% × billable_value, advance_balance)
secured_adjustment     = secured_advance_this_bill − secured_advance_previous   # + paid / − recovered
total_deductions       = retention + TDS + cess + mobilization_recovery + other
NET PAYABLE            = total_invoice_value − total_deductions + secured_adjustment
```

### Roles & workflow
Site Engineer (measures, drafts) → Quantity Surveyor (checks) → Project Manager (certifies, approves).
Only an **Approved** bill (docstatus 1) can generate an invoice.

---

## 2. Backend unit tests (`bench run-tests --app ra_bill`)

File: `ra_bill/ra_bill/doctype/ra_bill/test_ra_bill.py` — **9 cases, all passing.**

| # | Test | What it verifies | Key expected values |
|---|------|------------------|---------------------|
| 1 | `test_item_rate_cumulative` | RA-1 then RA-2 cumulative math; previous qty auto-pulled | RA-1 gross 720,000; RA-2 previous 720,000, this bill 990,000, item current_qty 300 |
| 2 | `test_percentage_billing` | Percentage Completion method | RA-1 gross 300,000 (30% of 1,000,000); RA-2 gross 400,000, previous% 30 |
| 3 | `test_retention_cap` | Cumulative retention capped at % of contract value | RA-1 30,000; RA-2 capped 20,000; RA-3 capped 0 (cap 50,000) |
| 4 | `test_mobilization_recovery_capped_to_balance` | Advance recovery never exceeds balance | RA-1 recovers 144,000 (bal 200k→56k); RA-2 recovers 56,000 (bal→0) |
| 5 | `test_escalation_adds_to_billable` | Price escalation enters billable/taxable base | escalation 42,500; billable 162,500; net 162,500 |
| 6 | `test_secured_advance_adjustment_and_recovery` | Secured advance added then recovered; Project balance | RA-1 advance 90,000, net 210,000; RA-2 recovery −90,000, net 0 |
| 7 | `test_variation_order_items_flow` | VO cost impact; approved VO items pull into RA Bill | VO cost 50,000; bill gross 170,000 (120k work + 50k variation) |
| 8 | `test_measurement_book_pull` | MB entry quantities (no×L×B×D) aggregate per BOQ item | "Excavation" total 300 (200 + 100) |
| 9 | `test_invoice_generation_links_back` | Approved bill → Sales Invoice, linked both ways | SI net 120,000; SI.ra_bill = bill; bill.sales_invoice = SI |

---

## 3. Playwright E2E (`apps/ra_bill/playwright`)

Real Desk-UI flows driven through the app: link selection, "Get Items"/"Get Variation"/"Get MB"
handlers, child-table entry, **Save**, **certification workflow actions**, and **invoice buttons**.
**10 tests (incl. login), all passing.**

### 3.1 Client RA Bill — `client-ra-bill.spec.js`
| Scenario | Steps | Assertions |
|----------|-------|------------|
| **RA-1: measure → certify → GST Sales Invoice** | New RA Bill → project + client BOQ → Get Items → cumulative 400 & 100 → Save → walk workflow to Approved → Create Sales Invoice | bill_type Client; gross 720,000; cess 7,200; GST 130,896; sales_invoice created |
| **RA-2: cumulative running account** | New RA Bill on same BOQ → Get Items → cumulative 700 & 250 → Save → Approve | previous_qty 400; current_qty 300; gross 990,000; previous_billed 720,000; previous_ra_bill = RA-1 |

### 3.2 Subcontractor RA Bill — `subcontractor-ra-bill.spec.js`
| Scenario | Steps | Assertions |
|----------|-------|------------|
| **Subcontract RA-1 → TDS Purchase Invoice** | New RA Bill → subcontract BOQ → Get Items → 1000 & 500 → Save → Approve → Create Purchase Invoice | bill_type Subcontractor; gross 290,000; retention 10% = 29,000; PI created with `apply_tds = 1` |
| **Subcontract RA-2: recovery bill** | New RA Bill → Get Items → cumulative 900 & 700 (internal corrected down) → Save | item current_qty −100; gross 26,000 (recovery allowed) |

### 3.3 Subcontractor — full feature set — `subcontractor-full.spec.js`
*Each scenario seeds fresh, independent data (BOQ + Measurement Book + approved Variation Order).*

| Scenario | DocTypes exercised | Steps | Assertions |
|----------|--------------------|-------|------------|
| **Scenario 1: MB + secured advance + escalation + recovery deduction → TDS PI** | BOQ, Measurement Book, RA Bill (+ secured advance, escalation, deduction), Purchase Invoice | Get Items → set Measurement Book → **Get Quantities from MB** (1000 & 500) → add secured advance (200 × 400 × 90%) → add escalation (Steel, idx 100→110, 10 × 50,000 × 85%) → add Client Material Recovery 5,000 → Save → Approve → Create PI | gross 290,000; escalation 42,500; billable 332,500; secured advance 72,000 (adj +72,000); retention 33,250; **net 420,048.5**; PI created |
| **Scenario 2: incorporating an approved Variation Order** | BOQ, Variation Order, RA Bill, Purchase Invoice | Get Items → **Get Variation Items** (adds VO line) → cumulative 1000, 500, 50 → Save → Approve → Create PI | 3 items; items[2].variation_order set & is_extra_item; gross 310,000 (290k + 20k variation); PI created |

### 3.4 Billing methods — `billing-methods.spec.js`
| Scenario | Assertions |
|----------|------------|
| **Percentage Completion bill** | billing_method "Percentage Completion"; 30% of 1,000,000 → gross 300,000; reaches Approved |
| **Next bill advances milestones** | previous% 30; (60−30)% × 1,000,000 + 20% × 500,000 → gross 400,000 |

### 3.5 Workspace — `workspace.spec.js`
Renders the **Running Account Billing** workspace with cards Documents / Reports / Setup and shortcuts.

---

## 4. Worked example — Subcontractor Scenario 1 (the "complete" bill)

Subcontract BOQ: Internal plastering 2,500 @ 180, External plastering 1,200 @ 220.
Terms: retention 10%, TDS 2%, labour cess 1%, GST 18%.

| Line | ₹ |
|------|---|
| Work this bill (1000×180 + 500×220) | 290,000.00 |
| + Price escalation (Steel) | 42,500.00 |
| **Billable value** | **332,500.00** |
| + Labour cess @ 1% | 3,325.00 |
| + GST @ 18% on (332,500 + 3,325) | 60,448.50 |
| **Total invoice value** | **396,273.50** |
| − Retention @ 10% of billable | (33,250.00) |
| − TDS @ 2% of billable | (6,650.00) |
| − Labour cess @ 1% | (3,325.00) |
| − Client material recovery | (5,000.00) |
| **Total deductions** | **(48,225.00)** |
| + Secured advance (Cement 200 × 400 × 90%) | 72,000.00 |
| **NET PAYABLE** | **420,048.50** |

---

## 5. How to run
```bash
# backend
bench --site demo1 set-config allow_tests true
bench --site demo1 run-tests --app ra_bill

# E2E
bench --site demo1 execute ra_bill.demo.ensure_e2e_user
cd apps/ra_bill/playwright && npm install && npx playwright install chromium
RA_BASE_URL=http://localhost:8001 npx playwright test
```
