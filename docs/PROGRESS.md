# RA Bill App — Progress Tracker

> Single source of truth for "where are we right now". Update at the end of every working session.

**App:** `ra_bill` · **Bench:** `/home/surendhra/frappe-bench-v15_1` · **Site:** `demo1`
**Frappe:** 15.111.1 · **ERPNext:** 15.111.0 · **Also installed:** hrms, india_compliance
**Goal:** Production-grade, marketplace-ready custom app for the Running Account (RA) Bill process in construction / real estate.

---

## Status legend
✅ done · 🟡 in progress · ⬜ not started · ⚠️ blocked

## Phase board

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Domain research (RA bill process) | ✅ | See `01-domain-ra-bill.md` |
| 0 | ERPNext architecture mapping | ✅ | See `02-erpnext-architecture.md` |
| 1 | Knowledge base scaffolding | ✅ | 01/02/03/04 + this tracker |
| 2 | App scaffold + install on demo1 | ✅ | `ra_bill` 0.0.1 installed |
| 3 | DocTypes (BOQ, RA Bill, Measurement Book + children) | ✅ | 8 doctypes synced on demo1 |
| 4 | Controllers (cumulative logic + invoice generation) | ✅ | Cumulative math + GST invoice verified |
| 5 | Roles, workflow, permissions, print formats, reports | ✅ | Workflow, 2 reports, CPWD print format, Workspace |
| 6 | Backend tests + migrate | ✅ | 5/5 unit tests pass |
| 7 | Playwright E2E real-world scenarios | ✅ | 8/8 pass: client, subcontractor, %/milestone, workspace |
| 8 | Marketplace readiness polish | ✅ | README, docs, demo seeder |

## Workspace
A public **Running Account Billing** workspace (`ra_bill/workspace/running_account_billing`) groups everything: shortcuts
(RA Bill, BOQ, Measurement Book, RA Bill Register) and cards — **Documents** (BOQ, RA Bill,
Measurement Book), **Reports** (RA Bill Register, RA Bill Abstract), **Setup** (RA Bill Settings).
Verified rendering via Playwright. *Named "Running Account Billing" (not "RA Bill") to avoid a
route collision with the RA Bill DocType — both would slug to `/app/ra-bill`.*

## Complete feature expansion (2026-06-15)
Added the remaining CPWD-grade features and connected the doctypes:
- **Variation Order** (+ Variation Order Item) — submittable, auto cost-impact; approved VO lines pull into RA Bills as extra items.
- **Secured Advance** (CPWD Part II) on RA Bill — reduced-rate materials at site, added then auto-recovered; tracked as Project `secured_advance_balance`.
- **Price Escalation** on RA Bill — index-based, enters the billable/taxable base.
- **Measurement Book → RA Bill** — "Get Quantities from Measurement Book" pulls period quantities (no×L×B×D) into cumulative qty; MB linked back on submit.
- **Connections (dashboards)**: BOQ → RA Bill / Variation Order / Measurement Book; RA Bill → Sales Invoice / Purchase Invoice; Measurement Book → RA Bill.
- **Link filters & navigation**: RA Bill filters boq/MB/previous-bill/cost-center; BOQ / Variation Order / Measurement Book have "Create" buttons and project-scoped queries; MB "Get BOQ Items".
- **Workspace** updated with Variation Order.
- Backend tests grew 5 → **9**; E2E grew to **10** (incl. 2 comprehensive subcontractor scenarios using every doctype). Process + test-case walkthrough in `05-test-cases.md`.

## Test coverage summary
- **Backend** (`bench run-tests --app ra_bill`): item-rate cumulative, percentage billing,
  retention cap, mobilization recovery cap, invoice generation back-link — **5/5 pass**.
- **Playwright** (`apps/ra_bill/playwright`): client RA-1 (workflow + GST SI) & RA-2 (cumulative),
  subcontractor RA-1 (workflow + TDS PI) & RA-2 (recovery bill), subcontractor full ×2 (MB +
  secured advance + escalation + deduction; Variation Order), percentage/milestone ×2,
  workspace render — **10/10 pass** (incl. login setup).

## Generic-design upgrade (per user KB, 2026-06-15)
Absorbed the user's CPWD-grade KB (`/home/surendhra/Running_Account_Billing_Knowledgebase.md`). Added: **billing_method** (Item Rate / Percentage / Milestone / Lump Sum) so one engine covers measured, area-based, milestone & lump-sum contracts; **retention cap**; **recovery/negative bills**; **deviation tolerance warning**; billing-period fields. Native integration documented in `04-features-and-native-integration.md` (GST templates, Tax Withholding Category, standard invoice postings). All verified by 5 passing unit tests.

---

## Decisions log
- **D1**: RA Bill is a **standalone submittable DocType that generates a standard Sales Invoice (client) / Purchase Invoice (subcontractor)** — NOT a subclass of Sales Invoice. Reason: cumulative-vs-additive impedance, and india_compliance applies GST/TDS to *standard* invoices via `doc_events` (not subclassing), so a generated standard invoice inherits GST + cumulative TDS for free.
- **D2**: **BOQ is a first-class master DocType** (versioned) — the contract backbone. RA Bills consume BOQ lines cumulatively.
- **D3**: Cumulative engine lives on **RA Bill Item**: `cumulative_qty` (measured to date) − `previous_qty` (from previous RA bill) = `current_qty`.
- **D4**: Every deduction's rate is **configurable per BOQ/contract** (retention %, mobilization recovery %, cess %). GST charged on (work value + cess) per Sec 15(2)(a) CGST; statutory deductions on net work value.
- **D5**: Retention & mobilization recovery tracked as running balances; staged retention release (completion + DLP end).

## Open questions / TODO backlog
- ✅ Subcontractor (Purchase) RA bill flow — DONE (native TDS Purchase Invoice).
- ✅ Secured/material advance recovery — DONE (`RA Bill Secured Advance`, auto-recovery, Project balance).
- ✅ Price escalation indexing — DONE (`RA Bill Escalation`, index-based, into billable base).
- Remaining phase-2 ideas: equipment advance tracker, material reconciliation, WIP/EVM dashboards, dedicated Final Bill doctype.

## Known issues / blockers
- ⚠️ **`acc_schedule3` app crashes `bench migrate`** at its `after_migrate` (`acc_schedule3/install.py:219` → `doc.is_locked = 1`, a read-only property). This runs *before* `ra_bill.after_migrate`, so our custom fields/workflow setup is skipped on a full migrate. **Workaround applied:** ran `ra_bill.setup.setup_custom_fields()` + `setup_workflow()` manually. **Permanent fix is the user's** (their app) — flagged.

## Session log
- **2026-06-15**: Researched RA bill domain + ERPNext mapping. Scaffolded app, installed on demo1. Built 8 DocTypes, controllers, roles, certification workflow, custom fields. Started KB.
- **MCP note**: `frappe_assistant_core` MCP (stdio bridge for Claude Desktop, server `http://40.40.40.12:8001`) is configured but NOT wired into the CLI session; development uses `bench` directly.
