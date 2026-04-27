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

## Batch Invoice Workflow

1. Open **Batch Invoices**.
2. Select date range.
3. Click **Generate Batch Invoices**.
4. System will:
   - find completed visits in range
   - skip already billed visits
   - group by customer
   - generate one invoice per customer
   - add visit line items
   - mark visits as billed
5. Review generated invoices in **Invoices**.
6. Update payment status in **Payments**.

## Netlify Deployment

This is a static app and can be deployed directly:

- Build command: *(none required)*
- Publish directory: `.`

Optional: drag-and-drop deploy the repository folder in Netlify.
