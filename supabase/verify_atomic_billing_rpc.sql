-- FieldCore Service atomic billing RPC verification.
--
-- Run this in a non-production Supabase SQL Editor after applying
-- fieldcore_service_schema.sql. Replace the UUID below with an existing
-- auth.users id that should act as an owner/admin/manager for the test company.
-- The script uses a transaction and rolls back all fixture data and temporary
-- failure triggers.

begin;

set local fieldcore_billing_rpc.user_id = '00000000-0000-0000-0000-000000000001';

do $$
begin
  if not exists (
    select 1
    from auth.users
    where id = current_setting('fieldcore_billing_rpc.user_id')::uuid
  ) then
    raise exception 'Replace fieldcore_billing_rpc.user_id with an existing auth.users id before running this verification.';
  end if;
end;
$$;

insert into public.companies (company_id, name, status)
values ('co_rpc_billing', 'RPC Billing Test Company', 'active')
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
values ('settings_rpc_billing', 'co_rpc_billing', 'RPC', 10, 0.10)
on conflict (settings_id) do update
set invoice_prefix = excluded.invoice_prefix,
    default_due_days = excluded.default_due_days,
    tax_rate = excluded.tax_rate;

insert into public.employees (employee_id, company_id, name, role, status)
values ('emp_rpc_billing_owner', 'co_rpc_billing', 'RPC Owner', 'Owner', 'active')
on conflict (employee_id) do update
set name = excluded.name,
    role = excluded.role,
    status = excluded.status;

insert into public.company_memberships (membership_id, company_id, user_id, employee_id, role, status)
values (
  'mbr_rpc_billing_owner',
  'co_rpc_billing',
  current_setting('fieldcore_billing_rpc.user_id')::uuid,
  'emp_rpc_billing_owner',
  'owner',
  'active'
)
on conflict (membership_id) do update
set user_id = excluded.user_id,
    employee_id = excluded.employee_id,
    role = excluded.role,
    status = excluded.status;

insert into public.customers (customer_id, company_id, name, status)
values
  ('cust_rpc_billing_a', 'co_rpc_billing', 'RPC Customer A', 'active'),
  ('cust_rpc_billing_b', 'co_rpc_billing', 'RPC Customer B', 'active')
on conflict (customer_id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.properties (
  property_id,
  company_id,
  customer_id,
  service_address,
  service_type,
  recurring_frequency,
  default_price,
  status
)
values
  ('prop_rpc_billing_a', 'co_rpc_billing', 'cust_rpc_billing_a', '1 RPC A Street', 'standard', 'one-time', 100, 'active'),
  ('prop_rpc_billing_b', 'co_rpc_billing', 'cust_rpc_billing_b', '1 RPC B Street', 'standard', 'one-time', 200, 'active')
on conflict (property_id) do update
set customer_id = excluded.customer_id,
    service_address = excluded.service_address,
    service_type = excluded.service_type,
    recurring_frequency = excluded.recurring_frequency,
    default_price = excluded.default_price,
    status = excluded.status;

insert into public.visits (
  visit_id,
  company_id,
  property_id,
  visit_date,
  service_description,
  price,
  status
)
values
  ('visit_rpc_one', 'co_rpc_billing', 'prop_rpc_billing_a', date '2031-01-01', 'One visit', 100, 'completed'),
  ('visit_rpc_multi_a', 'co_rpc_billing', 'prop_rpc_billing_a', date '2031-01-02', 'Multi A', 150, 'completed'),
  ('visit_rpc_multi_b', 'co_rpc_billing', 'prop_rpc_billing_b', date '2031-01-03', 'Multi B', 200, 'completed'),
  ('visit_rpc_fail_line', 'co_rpc_billing', 'prop_rpc_billing_a', date '2031-01-04', 'Fail line', 75, 'completed'),
  ('visit_rpc_fail_update', 'co_rpc_billing', 'prop_rpc_billing_a', date '2031-01-05', 'Fail update', 80, 'completed'),
  ('visit_rpc_ineligible', 'co_rpc_billing', 'prop_rpc_billing_a', date '2031-01-06', 'Ineligible', 90, 'scheduled')
on conflict (visit_id) do update
set property_id = excluded.property_id,
    visit_date = excluded.visit_date,
    service_description = excluded.service_description,
    price = excluded.price,
    status = excluded.status;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_billing_rpc.user_id'), true);

do $$
declare
  result jsonb;
begin
  result := public.generate_billing_invoices(
    'co_rpc_billing',
    array['visit_rpc_one'],
    'rpc-one',
    date '2031-02-01',
    date '2031-02-11'
  );

  if (result->>'created_count')::integer <> 1 then
    raise exception 'One-visit invoice generation did not create exactly one invoice.';
  end if;

  if (select status from public.visits where visit_id = 'visit_rpc_one') <> 'billed' then
    raise exception 'One-visit invoice generation did not mark visit billed.';
  end if;

  if (
    select total
    from public.invoices
    where company_id = 'co_rpc_billing'
      and idempotency_key = 'rpc-one'
    limit 1
  ) <> 110 then
    raise exception 'One-visit invoice total is incorrect.';
  end if;
end;
$$;

do $$
declare
  first_result jsonb;
  retry_result jsonb;
begin
  first_result := public.generate_billing_invoices(
    'co_rpc_billing',
    array['visit_rpc_multi_b', 'visit_rpc_multi_a'],
    'rpc-multi',
    date '2031-02-02',
    date '2031-02-12'
  );

  if (first_result->>'created_count')::integer <> 2 then
    raise exception 'Multi-visit generation should create one invoice per customer.';
  end if;

  retry_result := public.generate_billing_invoices(
    'co_rpc_billing',
    array['visit_rpc_multi_a', 'visit_rpc_multi_b'],
    'rpc-multi',
    date '2031-02-02',
    date '2031-02-12'
  );

  if coalesce((retry_result->>'idempotent_replay')::boolean, false) is not true then
    raise exception 'Retry did not return an idempotent replay.';
  end if;

  if (
    select count(*)
    from public.invoice_line_items
    where company_id = 'co_rpc_billing'
      and visit_id in ('visit_rpc_multi_a', 'visit_rpc_multi_b')
  ) <> 2 then
    raise exception 'Retry created duplicate line items.';
  end if;
end;
$$;

reset role;

create or replace function public.verify_atomic_billing_fail_line_item()
returns trigger
language plpgsql
as $$
begin
  if new.visit_id = 'visit_rpc_fail_line' then
    raise exception 'Simulated invoice line item failure.';
  end if;
  return new;
end;
$$;

create trigger verify_atomic_billing_fail_line_item
  before insert on public.invoice_line_items
  for each row execute function public.verify_atomic_billing_fail_line_item();

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_billing_rpc.user_id'), true);

do $$
begin
  begin
    perform public.generate_billing_invoices(
      'co_rpc_billing',
      array['visit_rpc_fail_line'],
      'rpc-fail-line',
      date '2031-02-03',
      date '2031-02-13'
    );
    raise exception 'Simulated invoice line item failure did not fail.';
  exception
    when others then
      if sqlerrm = 'Simulated invoice line item failure did not fail.' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.invoices
    where company_id = 'co_rpc_billing'
      and idempotency_key = 'rpc-fail-line'
  ) then
    raise exception 'Invoice remained after simulated line item failure.';
  end if;

  if (select status from public.visits where visit_id = 'visit_rpc_fail_line') <> 'completed' then
    raise exception 'Visit status changed after simulated line item failure.';
  end if;
end;
$$;

reset role;
drop trigger verify_atomic_billing_fail_line_item on public.invoice_line_items;
drop function public.verify_atomic_billing_fail_line_item();

create or replace function public.verify_atomic_billing_fail_visit_update()
returns trigger
language plpgsql
as $$
begin
  if new.visit_id = 'visit_rpc_fail_update' and new.status = 'billed' then
    raise exception 'Simulated visit update failure.';
  end if;
  return new;
end;
$$;

create trigger verify_atomic_billing_fail_visit_update
  before update on public.visits
  for each row execute function public.verify_atomic_billing_fail_visit_update();

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_billing_rpc.user_id'), true);

do $$
begin
  begin
    perform public.generate_billing_invoices(
      'co_rpc_billing',
      array['visit_rpc_fail_update'],
      'rpc-fail-update',
      date '2031-02-04',
      date '2031-02-14'
    );
    raise exception 'Simulated visit update failure did not fail.';
  exception
    when others then
      if sqlerrm = 'Simulated visit update failure did not fail.' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.invoices
    where company_id = 'co_rpc_billing'
      and idempotency_key = 'rpc-fail-update'
  ) then
    raise exception 'Invoice remained after simulated visit update failure.';
  end if;

  if exists (
    select 1
    from public.invoice_line_items
    where company_id = 'co_rpc_billing'
      and visit_id = 'visit_rpc_fail_update'
  ) then
    raise exception 'Line item remained after simulated visit update failure.';
  end if;

  if (select status from public.visits where visit_id = 'visit_rpc_fail_update') <> 'completed' then
    raise exception 'Visit status changed after simulated visit update failure.';
  end if;
end;
$$;

reset role;
drop trigger verify_atomic_billing_fail_visit_update on public.visits;
drop function public.verify_atomic_billing_fail_visit_update();

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_billing_rpc.user_id'), true);

do $$
begin
  begin
    perform public.generate_billing_invoices(
      'co_rpc_billing',
      array['visit_rpc_ineligible'],
      'rpc-ineligible',
      date '2031-02-05',
      date '2031-02-15'
    );
    raise exception 'Ineligible visit billing did not fail.';
  exception
    when others then
      if sqlerrm = 'Ineligible visit billing did not fail.' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.invoices
    where company_id = 'co_rpc_billing'
      and idempotency_key = 'rpc-ineligible'
  ) then
    raise exception 'Invoice remained after ineligible visit failure.';
  end if;
end;
$$;

reset role;

rollback;
