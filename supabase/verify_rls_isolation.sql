-- FieldCore Service RLS isolation verification.
--
-- Run this in the Supabase SQL Editor after applying fieldcore_service_schema.sql.
-- Before running, replace the UUID values below with four existing auth.users ids
-- from a non-production test project. The script seeds two companies, impersonates
-- each user through request.jwt.claim.sub, asserts expected RLS behavior, and
-- rolls back all seeded data.

begin;

set local fieldcore_rls.owner_a_user_id = '00000000-0000-0000-0000-000000000001';
set local fieldcore_rls.admin_a_user_id = '00000000-0000-0000-0000-000000000002';
set local fieldcore_rls.employee_a_user_id = '00000000-0000-0000-0000-000000000003';
set local fieldcore_rls.owner_b_user_id = '00000000-0000-0000-0000-000000000004';

do $$
declare
  missing_users integer;
begin
  select count(*)
  into missing_users
  from (
    values
      (current_setting('fieldcore_rls.owner_a_user_id')::uuid),
      (current_setting('fieldcore_rls.admin_a_user_id')::uuid),
      (current_setting('fieldcore_rls.employee_a_user_id')::uuid),
      (current_setting('fieldcore_rls.owner_b_user_id')::uuid)
  ) as required_users(user_id)
  where not exists (
    select 1
    from auth.users u
    where u.id = required_users.user_id
  );

  if missing_users > 0 then
    raise exception 'Replace fieldcore_rls.*_user_id settings with existing auth.users ids before running this verification.';
  end if;
end;
$$;

insert into public.companies (company_id, name, status)
values
  ('co_rls_a', 'RLS Company A', 'active'),
  ('co_rls_b', 'RLS Company B', 'active')
on conflict (company_id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.company_settings (settings_id, company_id, invoice_prefix, default_due_days, tax_rate)
values
  ('settings_rls_a', 'co_rls_a', 'A', 15, 0),
  ('settings_rls_b', 'co_rls_b', 'B', 15, 0)
on conflict (settings_id) do update
set invoice_prefix = excluded.invoice_prefix,
    default_due_days = excluded.default_due_days,
    tax_rate = excluded.tax_rate;

insert into public.employees (employee_id, company_id, name, role, status)
values
  ('emp_rls_owner_a', 'co_rls_a', 'Owner A', 'Owner', 'active'),
  ('emp_rls_admin_a', 'co_rls_a', 'Admin A', 'Admin', 'active'),
  ('emp_rls_worker_a', 'co_rls_a', 'Worker A', 'Worker', 'active'),
  ('emp_rls_owner_b', 'co_rls_b', 'Owner B', 'Owner', 'active')
on conflict (employee_id) do update
set name = excluded.name,
    role = excluded.role,
    status = excluded.status;

insert into public.company_memberships (membership_id, company_id, user_id, employee_id, role, status)
values
  ('mbr_rls_owner_a', 'co_rls_a', current_setting('fieldcore_rls.owner_a_user_id')::uuid, 'emp_rls_owner_a', 'owner', 'active'),
  ('mbr_rls_admin_a', 'co_rls_a', current_setting('fieldcore_rls.admin_a_user_id')::uuid, 'emp_rls_admin_a', 'admin', 'active'),
  ('mbr_rls_employee_a', 'co_rls_a', current_setting('fieldcore_rls.employee_a_user_id')::uuid, 'emp_rls_worker_a', 'employee', 'active'),
  ('mbr_rls_owner_b', 'co_rls_b', current_setting('fieldcore_rls.owner_b_user_id')::uuid, 'emp_rls_owner_b', 'owner', 'active')
on conflict (membership_id) do update
set user_id = excluded.user_id,
    employee_id = excluded.employee_id,
    role = excluded.role,
    status = excluded.status;

insert into public.customers (customer_id, company_id, name, status)
values
  ('cust_rls_a', 'co_rls_a', 'Customer A', 'active'),
  ('cust_rls_b', 'co_rls_b', 'Customer B', 'active')
on conflict (customer_id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.service_plans (service_plan_id, company_id, name, service_type, recurring_frequency, default_price, status)
values
  ('plan_rls_a', 'co_rls_a', 'Plan A', 'standard', 'one-time', 100, 'active'),
  ('plan_rls_b', 'co_rls_b', 'Plan B', 'standard', 'one-time', 100, 'active')
on conflict (service_plan_id) do update
set name = excluded.name,
    service_type = excluded.service_type,
    recurring_frequency = excluded.recurring_frequency,
    default_price = excluded.default_price,
    status = excluded.status;

insert into public.properties (property_id, company_id, customer_id, service_plan_id, service_address, service_type, recurring_frequency, default_price, status)
values
  ('prop_rls_a', 'co_rls_a', 'cust_rls_a', 'plan_rls_a', '1 A Street', 'standard', 'one-time', 100, 'active'),
  ('prop_rls_b', 'co_rls_b', 'cust_rls_b', 'plan_rls_b', '1 B Street', 'standard', 'one-time', 100, 'active')
on conflict (property_id) do update
set customer_id = excluded.customer_id,
    service_plan_id = excluded.service_plan_id,
    service_address = excluded.service_address,
    service_type = excluded.service_type,
    recurring_frequency = excluded.recurring_frequency,
    default_price = excluded.default_price,
    status = excluded.status;

insert into public.routes (route_id, company_id, name, route_day, route_date, assigned_worker, employee_id, visit_ids)
values
  ('route_rls_a', 'co_rls_a', 'Route A', 'Monday', date '2030-01-07', 'Worker A', 'emp_rls_worker_a', '["visit_rls_a"]'::jsonb),
  ('route_rls_b', 'co_rls_b', 'Route B', 'Monday', date '2030-01-07', 'Owner B', 'emp_rls_owner_b', '["visit_rls_b"]'::jsonb)
on conflict (route_id) do update
set assigned_worker = excluded.assigned_worker,
    employee_id = excluded.employee_id,
    visit_ids = excluded.visit_ids;

insert into public.visits (visit_id, company_id, property_id, visit_date, service_description, price, status, route_id, route_name, route_day, assigned_worker)
values
  ('visit_rls_a', 'co_rls_a', 'prop_rls_a', date '2030-01-07', 'Visit A', 100, 'scheduled', 'route_rls_a', 'Route A', 'Monday', 'Worker A'),
  ('visit_rls_b', 'co_rls_b', 'prop_rls_b', date '2030-01-07', 'Visit B', 100, 'scheduled', 'route_rls_b', 'Route B', 'Monday', 'Owner B')
on conflict (visit_id) do update
set route_id = excluded.route_id,
    assigned_worker = excluded.assigned_worker,
    status = excluded.status;

insert into public.route_stops (route_stop_id, company_id, route_id, visit_id, stop_order)
values
  ('rs_rls_a', 'co_rls_a', 'route_rls_a', 'visit_rls_a', 1),
  ('rs_rls_b', 'co_rls_b', 'route_rls_b', 'visit_rls_b', 1)
on conflict (route_stop_id) do update
set route_id = excluded.route_id,
    visit_id = excluded.visit_id,
    stop_order = excluded.stop_order;

insert into public.invoices (invoice_id, company_id, customer_id, invoice_number, invoice_date, due_date, subtotal, tax, total, payment_status, amount_paid, customer_name)
values
  ('inv_rls_a', 'co_rls_a', 'cust_rls_a', 'RLS-A-1', date '2030-01-07', date '2030-01-22', 100, 0, 100, 'sent', 0, 'Customer A'),
  ('inv_rls_b', 'co_rls_b', 'cust_rls_b', 'RLS-B-1', date '2030-01-07', date '2030-01-22', 100, 0, 100, 'sent', 0, 'Customer B')
on conflict (invoice_id) do update
set payment_status = excluded.payment_status,
    amount_paid = excluded.amount_paid;

insert into public.invoice_line_items (line_item_id, company_id, invoice_id, visit_id, property_id, description, amount, line_order)
values
  ('ili_rls_a', 'co_rls_a', 'inv_rls_a', 'visit_rls_a', 'prop_rls_a', 'Line A', 100, 1),
  ('ili_rls_b', 'co_rls_b', 'inv_rls_b', 'visit_rls_b', 'prop_rls_b', 'Line B', 100, 1)
on conflict (line_item_id) do update
set amount = excluded.amount;

insert into public.payments (payment_id, company_id, invoice_id, amount, payment_date, method, notes)
values
  ('pay_rls_a', 'co_rls_a', 'inv_rls_a', 25, date '2030-01-08', 'cash', 'Payment A'),
  ('pay_rls_b', 'co_rls_b', 'inv_rls_b', 25, date '2030-01-08', 'cash', 'Payment B')
on conflict (payment_id) do update
set amount = excluded.amount;

insert into public.shifts (shift_id, company_id, employee_id, employee_name, started_at, ended_at)
values
  ('shift_rls_a', 'co_rls_a', 'emp_rls_worker_a', 'Worker A', timestamptz '2030-01-07 08:00:00+00', null),
  ('shift_rls_b', 'co_rls_b', 'emp_rls_owner_b', 'Owner B', timestamptz '2030-01-07 08:00:00+00', null)
on conflict (shift_id) do update
set employee_id = excluded.employee_id,
    employee_name = excluded.employee_name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at;

insert into public.activity_events (
  activity_event_id,
  company_id,
  customer_id,
  property_id,
  visit_id,
  invoice_id,
  payment_id,
  employee_id,
  event_type,
  title
)
values
  ('evt_rls_a', 'co_rls_a', 'cust_rls_a', 'prop_rls_a', 'visit_rls_a', 'inv_rls_a', 'pay_rls_a', 'emp_rls_worker_a', 'payment', 'Event A'),
  ('evt_rls_b', 'co_rls_b', 'cust_rls_b', 'prop_rls_b', 'visit_rls_b', 'inv_rls_b', 'pay_rls_b', 'emp_rls_owner_b', 'payment', 'Event B')
on conflict (activity_event_id) do update
set title = excluded.title;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('fieldcore_rls.owner_a_user_id'), true);

do $$
declare
  affected integer;
begin
  if (select count(*) from public.companies where company_id = 'co_rls_a') <> 1 then
    raise exception 'Owner A cannot read Company A.';
  end if;

  if (select count(*) from public.companies where company_id = 'co_rls_b') <> 0 then
    raise exception 'Owner A can read Company B.';
  end if;

  if (select count(*) from public.customers where company_id = 'co_rls_b') <> 0 then
    raise exception 'Owner A can read Company B customers.';
  end if;

  update public.customers
  set notes = 'rls violation'
  where customer_id = 'cust_rls_b';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Owner A can modify Company B customers.';
  end if;

  begin
    insert into public.properties (
      property_id,
      company_id,
      customer_id,
      service_address,
      service_type
    )
    values ('prop_rls_cross_customer', 'co_rls_a', 'cust_rls_b', 'Cross Customer', 'standard');
    raise exception 'Owner A inserted a Company A property linked to a Company B customer.';
  exception
    when insufficient_privilege or check_violation or foreign_key_violation then
      null;
  end;

  begin
    update public.route_stops
    set route_id = 'route_rls_b'
    where route_stop_id = 'rs_rls_a';
    raise exception 'Owner A updated a Company A route stop to a Company B route.';
  exception
    when insufficient_privilege or check_violation or foreign_key_violation then
      null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('fieldcore_rls.admin_a_user_id'), true);

do $$
declare
  affected integer;
begin
  update public.customers
  set notes = 'admin verified'
  where customer_id = 'cust_rls_a';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Admin A cannot update Company A customer.';
  end if;

  insert into public.activity_events (
    activity_event_id,
    company_id,
    customer_id,
    event_type,
    title
  )
  values ('evt_rls_admin_a', 'co_rls_a', 'cust_rls_a', 'admin_test', 'Admin event');
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('fieldcore_rls.employee_a_user_id'), true);

do $$
declare
  affected integer;
begin
  if (select count(*) from public.routes where route_id = 'route_rls_a') <> 1 then
    raise exception 'Employee A cannot read assigned Company A route.';
  end if;

  if (select count(*) from public.visits where visit_id = 'visit_rls_a') <> 1 then
    raise exception 'Employee A cannot read assigned Company A visit.';
  end if;

  if (select count(*) from public.route_stops where route_stop_id = 'rs_rls_a') <> 1 then
    raise exception 'Employee A cannot read assigned Company A route stop.';
  end if;

  if (select count(*) from public.shifts where shift_id = 'shift_rls_a') <> 1 then
    raise exception 'Employee A cannot read own Company A shift.';
  end if;

  if (select count(*) from public.routes where route_id = 'route_rls_b') <> 0 then
    raise exception 'Employee A can read Company B route.';
  end if;

  if (select count(*) from public.invoices) <> 0 then
    raise exception 'Employee A can read financial invoices.';
  end if;

  if (select count(*) from public.invoice_line_items) <> 0 then
    raise exception 'Employee A can read financial invoice line items.';
  end if;

  if (select count(*) from public.payments) <> 0 then
    raise exception 'Employee A can read financial payments.';
  end if;

  if (select count(*) from public.activity_events) <> 0 then
    raise exception 'Employee A can read restricted activity events.';
  end if;

  update public.invoices
  set payment_status = 'paid'
  where invoice_id = 'inv_rls_a';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Employee A can modify financial invoices.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('fieldcore_rls.owner_b_user_id'), true);

do $$
declare
  affected integer;
begin
  if (select count(*) from public.customers where customer_id = 'cust_rls_b') <> 1 then
    raise exception 'Owner B cannot read Company B customer.';
  end if;

  if (select count(*) from public.customers where customer_id = 'cust_rls_a') <> 0 then
    raise exception 'Owner B can read Company A customer.';
  end if;

  update public.payments
  set notes = 'owner b verified'
  where payment_id = 'pay_rls_b';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Owner B cannot update Company B payment.';
  end if;
end;
$$;

reset role;

rollback;
