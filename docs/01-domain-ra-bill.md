# RA Bill (Running Account Bill) — Domain Reference

> Foundation for the software model. Indian construction/real-estate practice, with international variants noted.

## 1. Definition & purpose
An **RA Bill (Running Account Bill)** is a **progressive / interim invoice** a contractor raises periodically (monthly or on milestone) to claim payment for the **value of work executed and materials supplied to date**, instead of waiting for project completion.

"Running account" = the contractor's account with the client is kept **open and cumulative**. Each bill (RA-1, RA-2, …) restates the **total value of all work done from day one to the current measurement date**, then **subtracts everything already certified/paid in previous bills** to get what is due *this period*. The account closes only with the **Final Bill**.

**Why it exists:** contractor cash flow (capital-intensive work), client risk control (pay only for measured verified work), audit trail/cost control.

**Two perspectives:** Contractor = revenue/receivable claim. Client/Owner = cost/payable; the owner's engineer/QS certifies the claim into an **Interim Payment Certificate (IPC)** before payment.

## 2. The full RA Bill lifecycle
**Setup (one-time):** Work Order/Contract → **BOQ** (priced itemized schedule: item, unit, contract qty, rate).

**Recurring cycle:**
1. Measurement at site → **Measurement Book (MB) / Joint Measurement Record** (primary legal evidence, jointly signed).
2. Prepare RA bill: pull cumulative qty per BOQ item; subtract previous cumulative → current qty; apply rate → gross value; add approved extra/deviation items; apply deductions & taxes.
3. Check & certify → **Interim Payment Certificate (IPC)** (site engineer → client QS/PMC → PM/director approval). Typically 7–15 days.
4. Payment: apply statutory deductions, file TDS, release net; contractor issues GST tax invoice.
5. Next RA bill repeats. **RA-(n) cumulative must equal RA-(n−1) cumulative + current period work** — core integrity check.

**Closure:** **Final Bill** reconciles all RA bills, deviations, escalation, balance retention, final advance recovery.

**Core formula:**
> **Current Bill Quantity = (Cumulative qty executed to date) − (Cumulative qty billed in previous bill)**

Errors self-correct: the next cumulative figure carries the correction, so the difference nets out — no need to reopen historical bills.

## 3. Key data elements & calculations

### BOQ line item
item code/description · unit (m³, m², m, kg, no., MT) · contract quantity · unit rate · contract amount (qty × rate).

### Quantity & gross value per item
```
current_bill_qty (item)  = cumulative_qty_to_date − previous_cumulative_qty
gross_value_this_bill (item) = current_bill_qty × unit_rate
gross_value_this_bill (total) = Σ items + approved extra/deviation items
```

### Mobilization advance & recovery
- Paid up-front (10–15% of contract value) against bank guarantee.
- Recovered at a fixed % (10–30%) of each bill's gross value until exhausted (full recovery by ~70–95% progress).
- `mobilization_recovery_this_bill = recovery% × gross_value_this_bill` (stop at zero balance).

### Secured / material advance (materials at site)
- 75–100% of value of non-perishable materials brought to site but not yet incorporated.
- Recovered automatically as those materials are consumed into billed work.

### Retention money / security deposit
- 5–10% withheld from each bill as defect security.
- `retention_this_bill = retention% × gross_value_this_bill`.
- Released in two stages: ~half on practical completion, balance after **Defect Liability Period (DLP, ~12 months)**.

### Price escalation / variation
- Indexed adjustment (cement/steel/fuel/labour) added per bill where the contract has an escalation clause; variations/extra items added via change order; deviation tracked on the deviation statement.

### Statutory deductions (India)
- **GST**: works contract = supply of service, generally **18%** (ITC eligible); affordable/specified housing **1% or 5%**.
- **GST TDS (Sec 51 CGST)**: Govt/notified PSU deduct **2%** on contracts > ₹2.5 lakh.
- **Income-Tax TDS u/s 194C**: **1%** (individual/HUF) / **2%** (others). Threshold: single > ₹30,000 or aggregate > ₹1,00,000/FY. **Computed on value excluding GST when GST is shown separately.**
- **Labour Welfare Cess (BOCW Cess Act 1996)**: **1% of construction cost**, deducted at source for Govt/PSU works.
- **GST–cess interaction**: per Sec 15(2)(a) CGST, cess is part of value of supply → **GST is charged on value inclusive of cess**.
- **Other recoveries**: client-supplied (free-issue) material recovery, water/electricity, liquidated damages, deductions for defective work.

### Net payable
```
A  Gross value of work this bill (incl. extra/deviation, escalation)
B  + GST (on A + cess, where cess in taxable base)
C  Total billed (A + B)
D  − Retention (% × A)
E  − Income-tax TDS 194C (on A, excl. GST)
F  − GST TDS (where applicable)
G  − Labour welfare cess (1% × A)
H  − Mobilization advance recovery
I  − Secured advance recovery
J  − Client-supplied material recovery / penalties / other
NET PAYABLE = C − (D+E+F+G+H+I+J)
```
**Modeling rule:** defaults — retention/194C/cess on net work value (excl. GST); GST on (work value + cess). Make each base configurable per contract.

### Worked example (illustrative; structure is the point)
Contract ₹1cr · GST 18% · retention 5% · 194C 2% · cess 1% · mobilization ₹15L recovered @20%/bill.

| | RA-1 (cum 20L) | RA-2 (cum 55L, +2L extra) | Final (cum work 1.03cr) |
|---|---|---|---|
| Current work value (A) | 20,00,000 | 35,00,000 + 2,00,000 = 37,00,000 | 46,00,000 |
| Cess 1% (in GST base) | 20,000 | 37,000 | 46,000 |
| GST 18% on (A+cess) | 3,63,600 | 6,72,660 | 8,36,280 |
| Total billed (C) | 23,83,600 | 44,09,660 | 54,82,280 |
| − Retention 5% of A | 1,00,000 | 1,85,000 | 2,30,000 |
| − 194C 2% of A | 40,000 | 74,000 | 92,000 |
| − Cess 1% of A | 20,000 | 37,000 | 46,000 |
| − Mobilization @20% of A | 4,00,000 | 7,40,000 | 3,60,000 (balance) |
| **Net payable** | **18,23,600** | **33,73,660** | (+ 50% retention release) |

## 4. Documents & roles
**Roles:** Site Engineer (records MB, drafts bill) → Billing Engineer / QS (validates qty, rates, calc) → Client QS/PMC (verifies) → Project Manager/Director (approves → certifies IPC) → Finance/Accounts (deductions, TDS, pays net).

**Supporting docs:** Measurement sheets/MB (primary evidence) · Abstract (summary roll-up) · Deviation statement (BOQ qty vs executed) · Hindrance register (client-caused delays) · Material reconciliation · test/quality certs, challans, change orders.

## 5. Contractor vs Owner accounting
| Aspect | Contractor (claimant) | Owner/Client (payer) |
|---|---|---|
| Nature | Revenue / Receivable | Cost / Payable |
| GST | Output GST (forward charge) | Pays GST, claims ITC |
| Retention | Receivable withheld (asset until released) | Liability held (released on completion/DLP) |
| Advances | Liability until recovered | Asset/prepayment recovered against bills |
| TDS 194C | Deducted from receipts; claimed as credit | Deductor; deposits TDS, issues Form 16A |
| WIP | Unbilled revenue / WIP | Capital WIP (CWIP) |

## 6. Variants & edge cases
Deviation/extra items · non-tendered items (new rate + change order before execution) · deductions for defective work · advance recovery % (mobilization fixed %, secured as consumed) · staged retention release tied to DLP · client-supplied material recovery · cumulative error self-correction · concessional GST (1%/5%).

## 7. International variants
- **FIDIC**: contractor's monthly Statement → Engineer's **Interim Payment Certificate (IPC)**. Same flow.
- **US AIA G702/G703**: **Schedule of Values** ≈ BOQ; G703 continuation sheet (work this period + previous + stored materials); G702 summary Application & Certificate for Payment with **retainage** (5–10%).
- **Terminology**: RA bill ↔ IPC / Progress Billing / Application for Payment · Retention ↔ Retainage · BOQ ↔ Schedule of Values · MB ↔ field measurement records.

## 8. Glossary
**RA Bill** cumulative interim invoice net of prior bills · **BOQ** priced itemized schedule · **MB/JMR** measurement record (jointly signed) · **IPC** engineer-certified pay instruction · **Abstract** summary roll-up · **Deviation statement** BOQ-vs-actual · **Hindrance register** client-delay log · **Retention/Security Deposit** 5–10% withheld · **DLP** defect liability period (~12mo) · **Mobilization advance** 10–15% up-front · **Secured/Material advance** 75–100% on materials at site · **Escalation** indexed rate adjustment · **TDS 194C** income-tax at source 1/2% · **GST TDS (Sec 51)** 2% Govt/PSU · **Labour Welfare Cess** 1% BOCW · **Final Bill** closing reconciliation.

## Sources
in4velocity, sitesetu (worked example & workflow), civilengpro (advances), sq-feet, buildrun (IPC), Designing Buildings (BOQ), ClearTax/TaxGuru (194C), BOCW Cess Act 1996 (India Code), taxo.online (GST on cess), Autodesk/Procore/Werx (AIA G702/G703).
