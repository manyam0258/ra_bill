# RA Bill — Playwright E2E tests

End-to-end tests driving the ERPNext Desk UI for the RA Bill app.

## Setup
```bash
cd apps/ra_bill/playwright
npm install
npx playwright install chromium
# provision the dedicated E2E user (System Manager + all RA roles)
bench --site <site> execute ra_bill.demo.ensure_e2e_user
```

## Run
```bash
RA_BASE_URL=http://localhost:8001 \
RA_USER=e2e@ra-bill.test RA_PASSWORD='RaBill@123456' \
npx playwright test
```

`auth.setup.js` logs in once and saves the session; each spec seeds fresh data via the
whitelisted `ra_bill.demo.seed_e2e` and drives the RA Bill form, certification workflow,
and invoice generation. Field/grid entry is performed through the app's own client API
(`cur_frm` / `frappe.model.set_value`) — running the real client scripts — while Save,
workflow transitions and invoice buttons are exercised as genuine UI actions.

## Cases
- `client-ra-bill.spec.js` — client RA-1 (workflow → GST Sales Invoice) and RA-2 (cumulative).
- `subcontractor-ra-bill.spec.js` — subcontract RA-1 (workflow → TDS Purchase Invoice) and RA-2 (recovery bill).
- `billing-methods.spec.js` — Percentage Completion / Milestone billing.
- `workspace.spec.js` — Running Account Billing workspace renders.
