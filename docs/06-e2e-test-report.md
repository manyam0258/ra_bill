# RA Bill — End-to-End Test Report

**App:** `ra_bill`  **Site:** `demo1`  **Date:** 2026-06-16
**Result: 17 / 17 passed** (16 scenarios + 1 auth setup), 0 failed.

These Playwright tests drive the real Frappe Desk UI (forms, grids, certification
workflow, invoice generation) against the running bench, exercising the model after
the **BOQ → RAB Work Order** rename and the move to configurable **Additions /
Deductions** child tables that each RA Bill carries forward.

---

## 1. Environment & how to run

| | |
|---|---|
| Base URL | `http://localhost:8001` (override with `RA_BASE_URL`) |
| Runner | `@playwright/test` (Chromium, headless, 1 worker, serial) |
| Test user | `e2e@ra-bill.test` (all RA roles) — see `RA_USER` / `RA_PASSWORD` |
| Data seed | `ra_bill.demo.seed_e2e` — a fresh Project + Work Orders per scenario |

```bash
cd apps/ra_bill/playwright
npm install            # first time only
npx playwright test               # full suite
npx playwright test real-world.spec.js   # one file
npx playwright show-report        # open the HTML report
```

`tests/auth.setup.js` logs in once and stores the session in `.auth/state.json`;
every spec reuses it. Shared UI helpers live in `tests/helpers.js`.

### Seed data (`seed_e2e`)
A fresh Project (mobilization advance ₹100,000) plus four Work Orders:

| Work Order | Type | Retention | TDS | Cess | Mob. recovery | GST | Items |
|---|---|---|---|---|---|---|---|
| `client_boq` | Client | 5% | 2% | 1% | 20% | 18% | Earthwork 1000@300, RCC 500@6000 |
| `subcon_boq` | Subcontractor | 10% | 2% | 1% | — | 18% | Int. plaster 2500@180, Ext. 1200@220 |
| `subcon_mob_boq` | Subcontractor | 10% | 2% | 1% | 15% | 18% | Brickwork 2000@250, Waterproofing 800@350 |
| `pct_boq` | Client (Percentage) | 5% | 2% | 1% | — | 18% | Superstructure, Finishing (milestones) |

Plus a submitted Measurement Book and an approved Variation Order on `subcon_boq`.

---

## 2. Coverage matrix

| Capability | Covered by |
|---|---|
| RAB Work Order form (rename, seeded charge tables, bulk Download/Upload) | RW‑1 |
| Carried-forward Additions/Deductions on the RA Bill | all bill tests |
| Item-rate cumulative running account (previous qty carry-forward) | RW‑3, SF‑1/2, SC‑1/2, CL‑2 |
| Percentage / Milestone billing | BM‑1, BM‑2 |
| Retention (with cumulative cap) | RW‑2/3, SC‑1, CL‑1 |
| TDS (194C) + Purchase Invoice withholding | RW‑2, SC‑1, SF‑1 |
| Labour cess in the GST base | CL‑1, RW tests |
| GST output tax + Sales Invoice (in/out-state template) | CL‑1, RW‑7 |
| Mobilization advance recovery (capped to project balance) | RW‑2, RW‑3 |
| Secured advance (materials at site) + later recovery | SF‑1, SC‑secured |
| Price escalation (index-based) | SF‑1 |
| Variation Order extra item billed | SF‑2 |
| Measurement Book → pull period quantities | SF‑1 |
| Ad-hoc fixed deductions (LD, water/electricity) | RW‑4 |
| Downward re-measurement → recovery (negative) bill | RW‑6, SC‑2 |
| Certification workflow Draft→Measured→Checked→Certified→Approved | every certified bill |
| Workspace shortcuts & cards | WS‑1 |

---

## 3. Test inventory & results

### `real-world.spec.js` — Subcontractor (multiple) + Client  *(new)*

**Subcontractor — running account with a mobilization advance** (`subcon_mob_boq`, serial)

- **RW‑1 · Open the Subcontractor Work Order** — verifies the renamed `RAB Work Order`
  form: `boq_type=Subcontractor`, `status=Active`, total ₹780,000, the **Deductions**
  table seeded with Retention/TDS/Labour Cess/Mobilization Recovery, the **Additions**
  table with Escalation/Secured Advance, and the items grid's **Download/Upload**
  (`allow_bulk_edit`).  ✅
- **RW‑2 · Bill 1 — part work + mobilization recovery → Purchase Invoice** — qty 1000/400
  ⇒ gross **₹390,000**; retention **₹39,000** (10%), TDS **₹7,800** (2%), mobilization
  recovery **₹58,500** (15%, advance balance ₹100,000); certified through the workflow and
  a **Purchase Invoice** is generated.  ✅
- **RW‑3 · Bill 2 — cumulative to 100%, recovery capped to remaining balance** — qty 2000/800,
  previous bill auto-linked, previous billed **₹390,000**, this bill gross **₹390,000**;
  remaining advance **₹41,500** so mobilization recovery is capped to **₹41,500**.  ✅

**Subcontractor — independent scenarios** (`subcon_boq`, fresh per test)

- **RW‑4 · Ad-hoc fixed deductions (liquidated damages + water/electricity)** — gross ₹290,000;
  adds two **Fixed Amount** deductions (₹15,000 + ₹3,000); total deductions **₹55,700**
  (29,000 retention + 5,800 TDS + 2,900 cess + 18,000 fixed).  ✅
- **RW‑5 · Secured advance for materials at site, recovered next bill** — bill 1 pays a secured
  advance (200 × ₹400 × 90% = **₹72,000**, adjustment +72,000); bill 2 has no materials at site,
  so the advance is recovered (**−₹72,000**).  ✅
- **RW‑6 · Downward re-measurement → recovery bill** — bill 1 at 1000 units (₹180,000); bill 2
  corrected to 800 units ⇒ this bill is **−₹36,000** with a negative net payable.  ✅

**Client — GST bill and Sales Invoice** (`client_boq`)

- **RW‑7 · Client bill applies 18% GST and certifies into a Sales Invoice** — qty 400/100 ⇒
  gross **₹720,000**, labour cess **₹7,200**, GST **₹130,896** (18% of 720,000 + cess);
  certified and a **Sales Invoice** is generated.  ✅

### `subcontractor-full.spec.js` — full feature set
- **SF‑1** · MB-pulled quantities + secured advance + escalation + ad-hoc recovery → TDS Purchase
  Invoice. gross 290,000, escalation 42,500, billable 332,500, secured advance 72,000, net
  **420,048.5**.  ✅
- **SF‑2** · Bill incorporating an approved Variation Order as an extra item → Purchase Invoice.  ✅

### `subcontractor-ra-bill.spec.js`
- **SC‑1** · RA‑1 measure, certify, generate Purchase Invoice with TDS (retention 29,000).  ✅
- **SC‑2** · RA‑2 recovery bill via downward re-measurement is allowed.  ✅

### `client-ra-bill.spec.js`
- **CL‑1** · RA‑1 measure, certify through workflow, generate GST Sales Invoice (cess 7,200, GST 130,896).  ✅
- **CL‑2** · RA‑2 cumulative running account pulls previous quantities (prev 720,000, cumulative 990,000).  ✅

### `billing-methods.spec.js`
- **BM‑1** · Percentage Completion bill computes from % of each line's contract value (300,000).  ✅
- **BM‑2** · Next bill advances milestones cumulatively (400,000).  ✅

### `workspace.spec.js`
- **WS‑1** · Running Account Billing workspace renders its shortcuts and cards.  ✅

---

## 4. Notes & constraints

- **Work Order creation is exercised via the form's read path** (RW‑1 opens a seeded Work
  Order and asserts the new tables + bulk-edit). New-document *creation* through the Desk
  form is blocked for the test user because ERPNext's **Project** DocType does not grant
  `read`/`select` to the user's roles (System Manager included), so the link control's
  `validate_link` returns 403. `seed_e2e` creates Work Orders server-side with
  `ignore_permissions`. Granting the e2e user a Projects role would enable full UI creation.
- **Backend `bench run-tests` cannot bootstrap in this environment** (no active Fiscal Year for
  2026; india_compliance rejects zero-rate Item Tax Templates). The controller math is covered
  here end-to-end through the UI, and separately validated via rolled-back transactions.
- Each scenario seeds its own Project/Work Orders, so reruns are independent and leave E2E data
  behind. Clear it any time with the same purge used before this run (cancel+delete invoices →
  RA Bills → Measurement Books → Variation Orders → RAB Work Orders, then reset Project balances).
- Latest HTML report: `playwright/playwright-report/index.html` (`npx playwright show-report`).
