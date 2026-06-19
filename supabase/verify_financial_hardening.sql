-- FieldCore Service financial hardening verification.
--
-- Run this in a non-production Supabase SQL Editor after applying
-- fieldcore_service_schema.sql. Replace the UUID below with an existing
-- auth.users id that should act as an owner/admin/manager for the test company.
-- The script uses a transaction and rolls back all fixture data.

begin;

set local fieldcore_financial.user_id = '00000000-0000-0000-0000-000000000001';

do $$
begin
  if not exists (
    select 1
    from auth.users
    where id = current_setting('fieldcore_financial.user_id')::uuid
  ) then
    raise exception 'Replace fieldcore_financial.user_id with an existing auth.users id before running this verification.';
  end if;
end;
$$;

insert into public.companies (company_id, name, status)
values ('co_financial_hardening', 'Financial Hardening Test Company', 'active')
on conflict (company_id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.company_settings (
  settings_id,
  company_id,
  invoice_prefix,
  default_due_days,
  tax_rate
)
values ('settings_financial_hardening', 'co_financial_hardening', 'FIN', 15, 0)
on conflict (settings_id) do update
set invoice_prefix = excluded.invoice_prefix,
    default_due_days = excluded.default_due_days,
    tax_rate = excluded.tax_rate;

insert into public.employees (employee_id, company_id, name, role, status)
values ('emp_financial_owner', 'co_financial_hardening', 'Financial Owner', 'Owner', 'active')
on conflict (employee_id) do update
set name = excluded.name,
    role = excluded.role,
    status = excluded.status;

insert into public.company_memberships (membership_id, company_id, user_id, employee_id, role, status)
values (
  'mbr_financial_owner',
  'co_financial_hardening',
  current_setting('fieldcore_financial.user_id')::uuid,
  'emp_financial_owner',
  'owner',
  'active'
)
on conflict (membership_id) do update
set user_id = excluded.user_id,
    employee_id = excluded.employee_id,
    role = excluded.role,
    status = excluded.status;

insert into public.customers (customer_id, company_id, name, status)
values ('cust_financial', 'co_financial_hardening', 'Financial Customer', 'active')
on conflict (customer_id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.invoices (
  invoice_id,
  company_id,
  customer_id,
  invoice_number,
  invoice_sequence,
  invoice_date,
  due_date,
  subtotal,
  tax,
  total,
  payment_status,
  amount_paid,
  customer_name
)
values
  ('inv_financial_partial', 'co_financial_hardening', 'cust_financial', 'FIN-2032-0001', 1, date '2032-01-01', date '2032-01-16', 100, 0, 100, 'sent', 0, 'Financial Customer'),
  ('inv_financial_full', 'co_financial_hardening', 'cust_financial', 'FIN-2032-0002', 2, date '2032-01-01', date '2032-01-16', 125, 0, 125, 'sent', 0, 'Financial Customer'),
  ('inv_financial_overpay', 'co_financial_hardening', 'cust_financial', 'FIN-2032-0003', 3, date '2032-01-01', date '2032-01-16', 50, 0, 50, 'sent', 0, 'Financial Customer')
on conflict (invoice_id) do update
set total = excluded.total,
    payment_status = excluded.payment_status,
    amount_paid = excluded.amount_paid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_financial.user_id'), true);

do $$
declare
  result jsonb;
begin
  if (
    select payment_status
    from public.invoices
    where invoice_id = 'inv_financial_partial'
  ) <> 'sent' then
    raise exception 'Invoice with no payments did not remain sent/open.';
  end if;

  result := public.record_invoice_payment(
    'co_financial_hardening',
    'inv_financial_partial',
    40,
    date '2032-01-02',
    'cash',
    'Partial payment',
    'pay-partial-1',
    false
  );

  if (result->'invoice'->>'amount_paid')::numeric <> 40 then
    raise exception 'Partial payment did not update amount_paid.';
  end if;

  if result->'invoice'->>'payment_status' <> 'partially_paid' then
    raise exception 'Partial payment did not set partially_paid.';
  end if;

  result := public.record_invoice_payment(
    'co_financial_hardening',
    'inv_financial_full',
    125,
    date '2032-01-02',
    'card',
    'Full payment',
    'pay-full-1',
    false
  );

  if (result->'invoice'->>'amount_paid')::numeric <> 125 then
    raise exception 'Full payment did not update amount_paid.';
  end if;

  if result->'invoice'->>'payment_status' <> 'paid' then
    raise exception 'Full payment did not set paid.';
  end if;

  result := public.record_invoice_payment(
    'co_financial_hardening',
    'inv_financial_full',
    125,
    date '2032-01-02',
    'card',
    'Full payment',
    'pay-full-1',
    false
  );

  if coalesce((result->>'idempotent_replay')::boolean, false) is not true then
    raise exception 'Payment retry did not return idempotent replay.';
  end if;

  if (
    select count(*)
    from public.payments
    where company_id = 'co_financial_hardening'
      and idempotency_key = 'pay-full-1'
  ) <> 1 then
    raise exception 'Payment retry created duplicate payment.';
  end if;

  begin
    perform public.record_invoice_payment(
      'co_financial_hardening',
      'inv_financial_full',
      125,
      date '2032-01-02',
      'card',
      'Full payment changed details',
      'pay-full-1',
      false
    );
    raise exception 'Mismatched payment replay was accepted.';
  exception
    when raise_exception then
      if sqlerrm <> 'Payment idempotency key was already used for a different payment.' then
        raise;
      end if;
  end;

  begin
    perform public.record_invoice_payment(
      'co_financial_hardening',
      'inv_financial_overpay',
      75,
      date '2032-01-02',
      'cash',
      'Overpayment',
      'pay-overpay-1',
      false
    );
    raise exception 'Overpayment did not fail.';
  exception
    when others then
      if sqlerrm = 'Overpayment did not fail.' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.payments
    where company_id = 'co_financial_hardening'
      and idempotency_key = 'pay-overpay-1'
  ) then
    raise exception 'Overpayment failure inserted a payment.';
  end if;

  if (
    select amount_paid
    from public.invoices
    where invoice_id = 'inv_financial_overpay'
  ) <> 0 then
    raise exception 'Overpayment failure changed invoice amount_paid.';
  end if;

  begin
    perform public.record_invoice_payment(
      'co_financial_hardening',
      'inv_financial_full',
      124,
      date '2032-01-02',
      'card',
      'Mismatched retry',
      'pay-full-1',
      false
    );
    raise exception 'Mismatched payment retry did not fail.';
  exception
    when others then
      if sqlerrm = 'Mismatched payment retry did not fail.' then
        raise;
      end if;
  end;

  if (
    select count(*)
    from public.activity_events
    where company_id = 'co_financial_hardening'
      and event_type in ('payment.recorded', 'invoice.status_changed')
  ) < 4 then
    raise exception 'Expected payment/status audit events were not written.';
  end if;

  if (
    select round(total - amount_paid, 2)
    from public.invoices
    where invoice_id = 'inv_financial_partial'
  ) <> 60 then
    raise exception 'AR balance for partial invoice is incorrect.';
  end if;

  if (
    select round(total - amount_paid, 2)
    from public.invoices
    where invoice_id = 'inv_financial_full'
  ) <> 0 then
    raise exception 'AR balance for full invoice is incorrect.';
  end if;
end;
$$;

reset role;

rollback;
