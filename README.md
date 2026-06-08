# ServiceBatch Invoice (MVP)

ServiceBatch Invoice is a lightweight standalone Progressive Web App (PWA-style) for small service businesses that bill from completed service visits in batches.

## MVP Scope

This app supports the daily workflow:

**Customer → Property → Service Visit → Batch Invoice → Payment Status**

Included modules:

- Dashboard
- Customers
- Properties / Service Locations
- Service Visits
- Batch Invoice Generator
- Invoices
- Payments / Outstanding Tracking
- Settings

Out of scope by design:

- Quoting
- Materials tracking
- Job chat
- Payment gateway integration
- Subscription billing
- Company switching UI
- Role-based access control

## Tech Choices

- Vanilla HTML/CSS/JavaScript (fast startup, low complexity)
- Mobile-first responsive layout
- Desktop left sidebar + mobile bottom navigation
- LocalStorage persistence with seed reset
- Service worker + web manifest for PWA-style installability
- Static hosting ready (Netlify compatible)

## Data Architecture

The app is single-company for MVP, but every domain model includes `company_id` for future multi-tenant SaaS compatibility.

Models included:

- customers
- properties
- visits
- invoices
- payments
- settings

### Persistence Centralization Note

Phase 1 of the Supabase migration prep adds a compatibility layer around the existing `servicebatch_invoice_mvp_v1` localStorage state. New persistence work should route through `src/data/storage/local-state-adapter.js` and `src/data/appEventBus.js` before feature modules are migrated to repositories. Existing feature modules still use their current localStorage paths during this phase so app behavior remains unchanged.

The first repository conversion is read-only: `src/data/repositories/visitReadRepository.js` now supplies visit/property reads for the next scheduled visit indicator. This proves the repository path without changing route planning, billing, invoice, payment, or visit lifecycle writes.

The first write repository conversion is intentionally low risk: `src/data/repositories/propertyRepository.js` owns property access-info updates and emits `properties:changed` after successful local adapter writes. Route, visit, billing, invoice, payment, authentication, and shift write paths remain unchanged.

## Seed Demo Dataset

Preloaded lawn-care scenario includes:

- 1 company
- 5 customers
- 8 properties
- recurring weekly/biweekly/monthly/one-time setups
- completed visits ready for invoicing
- existing partial and overdue invoices

Use **Settings → Reset Demo Data** to restore seed records.

## Run Locally

From repo root:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

## Billing Queue Workflow

1. Open **Billing Queue**.
2. Filter by Today, This Week, This Month, or All and sort by newest or oldest service date.
3. Review completed visits individually.
4. Select the visits that should be invoiced.
5. Click **Generate Invoices**.
6. System will:
   - use only selected completed visits
   - group by customer
   - generate one invoice per customer
   - add visit line items
   - mark visits as billed
7. Review generated invoices in **Invoices**.
8. Update payment status in **Payments**.

## Netlify Deployment

This is a static app and can be deployed directly:

- Build command: *(none required)*
- Publish directory: `.`

Optional: drag-and-drop deploy the repository folder in Netlify.
