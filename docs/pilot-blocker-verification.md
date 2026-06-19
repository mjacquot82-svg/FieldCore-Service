# Pilot Blocker Verification Notes

## Production Mode

- `demo` is the only mode that may use local demo storage as an authority.
- `production` is the only mode that may use Supabase-backed production repositories.
- Missing, empty, or misspelled modes must render the startup blocker and must not load seeded/local state.

## Payment Idempotency

- Default payment idempotency keys are unique per client payment request.
- Retries must provide the same caller-generated idempotency key.
- The `record_invoice_payment` RPC must accept exact replays only.
- The RPC must reject reused idempotency keys when invoice, amount, date, method, or notes differ.

## Pilot Financial Permissions

- Owner/admin may read financial screens and perform billing, payment, invoice export, and invoice send actions.
- Manager may use operational screens but may not access financial navigation, create invoices, record payments, export invoices, send invoices, or read payment data.
- Employee remains limited to assigned employee workflow.

## Operational Diagnostics

- The diagnostics panel is owner/admin only.
- Production diagnostics redact business-sensitive fields including names, emails, invoice ids, payment ids, sent recipients, amounts, totals, balances, prices, and raw error details.

## Invoice Export And Send

- Export attempts that cannot open a print window are logged as attempts and must not mark the invoice exported.
- Completed export tracking occurs only after a print window opens and the print workflow is invoked.
- Production export refreshes invoice and payment data from Supabase before rendering the printable invoice.
- Mark sent remains a manual confirmation that stores `sent_at`, `sent_to`, and `delivery_status`.

## Production localStorage Classification

- Demo-only authoritative storage: `local-state-adapter`, demo seed/session flows, and explicitly selected demo mode.
- Production non-authoritative cache: repository sync writes used to hydrate existing UI render paths after Supabase reads.
- Disabled in production as authoritative direct readers: route day flow, crew progress, payroll panel, recurring schedule enhancer, route-card quick actions, skip reason capture lookup, visit status sync snapshots, and actual completion localStorage mutation tracking.
- Supabase auth/config localStorage entries are configuration/session persistence, not business data authority.
