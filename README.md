# RA Bill — Running Account Billing for ERPNext

Progressive / interim **Running Account (RA) Billing** for the construction & real‑estate
industry, built on Frappe v15 + ERPNext v15 and integrated with **India Compliance**
(GST + TDS). Covers the full lifecycle: **BOQ → Measurement → cumulative RA Bills →
retention & advance recoveries → certification workflow → GST/TDS invoice**.

> Works for contractors billing clients **and** main‑contractors billed by subcontractors.

## Why
ERPNext invoices are *additive*; construction RA bills are *cumulative* — each bill restates
total work done to date and subtracts what was already billed. This app adds that cumulative
engine and the construction billing surface, while **reusing** ERPNext's accounting,
GST templates and Tax Withholding (TDS) rather than reinventing them.

## Features
- **BOQ (Bill of Quantities)** master — versioned, with contract terms (retention %, retention
  cap, mobilization advance & recovery %, labour cess %, TDS %, GST %, deviation tolerance).
- **Four billing methods** (one engine): **Item Rate (Measured)**, **Percentage Completion**,
  **Milestone**, **Lump Sum** — covers measured, area‑based, milestone and lump‑sum contracts.
- **RA Bill** — cumulative measurement engine (`this bill = cumulative − previous`), auto‑pulls
  previous quantities, computes gross, labour cess, GST (preview), retention (with cap),
  TDS, mobilization‑advance recovery (capped to balance), and other deductions.
- **Recovery / negative bills** for re‑measurement corrections; deviation‑tolerance warnings.
- **Variation Orders** — approved extra/changed items pulled into RA Bills as extra items.
- **Secured Advance** (CPWD Part II) — reduced‑rate materials at site, added then auto‑recovered.
- **Price Escalation** — index‑based, flows into the billable/taxable base.
- **Measurement Book** (no × L × B × D) for site records; "Get Quantities from Measurement Book".
- **Connections** between BOQ ↔ RA Bill / Variation Order / Measurement Book ↔ Sales/Purchase Invoice.
- **Certification workflow**: Draft → Measured → Checked → Certified → Approved
  (Site Engineer → Quantity Surveyor → Project Manager).
- **Invoice generation**: a certified bill creates a standard **Sales Invoice** (client) or
  **Purchase Invoice** (subcontractor) — GST applied via native templates, TDS via the native
  **Tax Withholding Category**, fully linked back.
- **Reports**: RA Bill Register, RA Bill Abstract (item‑wise BOQ status).
- **Print format**: CPWD‑style RA Bill memorandum.
- **Workspace** grouping all DocTypes and reports.
- Running balances on **Project** (mobilization advance, retention held).

## Install
```bash
bench get-app ra_bill $URL_OF_THIS_REPO
bench --site <site> install-app ra_bill
bench --site <site> migrate
```
Requires: `frappe` v15, `erpnext` v15. Recommended: `india_compliance` for GST/TDS.

## Quick start
1. **RA Bill Settings** → set a *Default Service Item* (a non‑stock service item with an HSN/SAC),
   and optional retention/advance accounts.
2. Create a **BOQ** for a Project (choose Client/Subcontractor, billing method, terms, line items) → Submit.
3. Create an **RA Bill** → pick the BOQ → *Get Items from BOQ* → enter cumulative quantities
   (or % complete) → Save. Deductions and net payable compute automatically.
4. Advance it through the **certification workflow** to *Approved*.
5. Click **Create Sales Invoice / Create Purchase Invoice** to post to accounts (GST + TDS applied).

A ready demo can be seeded with:
```bash
bench --site <site> execute ra_bill.demo.setup_demo
```

## Documentation
See [`docs/`](./docs):
- `PROGRESS.md` — build status & decisions
- `01-domain-ra-bill.md` — RA bill domain reference
- `02-erpnext-architecture.md` — ERPNext mapping & design
- `03-data-model.md` — DocType specifications
- `04-features-and-native-integration.md` — generic design & native ERPNext/India‑Compliance use
- `05-test-cases.md` — process walkthrough + every backend & E2E test case with expected results

## Testing
- **Backend** (Frappe unit tests):
  ```bash
  bench --site <site> set-config allow_tests true
  bench --site <site> run-tests --app ra_bill
  ```
- **End‑to‑end** (Playwright — client, subcontractor, percentage/milestone, workspace):
  ```bash
  cd apps/ra_bill/playwright && npm install && npx playwright install chromium
  bench --site <site> execute ra_bill.demo.ensure_e2e_user
  RA_BASE_URL=http://localhost:8001 npx playwright test
  ```

## Contributing
This app uses `pre-commit` (ruff, eslint, prettier, pyupgrade):
```bash
cd apps/ra_bill && pre-commit install
```

## License
MIT
