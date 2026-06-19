-- FieldCore Service production schema for Supabase.
-- Paste this file into the Supabase SQL Editor and run it as one script.
-- RLS policies cover all company-scoped operational and financial tables.

begin;

create extension if not exists pgcrypto;

set local check_function_bodies = off;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.companies (
  company_id text primary key default ('co_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_status_check check (status in ('active', 'inactive'))
);

create table if not exists public.company_settings (
  settings_id text primary key default ('settings_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  invoice_prefix text not null default 'FC',
  default_due_days integer not null default 15,
  tax_rate numeric(7, 6) not null default 0,
  payroll_week_start text not null default 'sunday',
  admin_pin text,
  admin_pin_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_settings_company_id_key unique (company_id),
  constraint company_settings_default_due_days_check check (default_due_days >= 0),
  constraint company_settings_tax_rate_check check (tax_rate >= 0),
  constraint company_settings_payroll_week_start_check check (payroll_week_start in ('sunday', 'monday')),
  constraint company_settings_admin_pin_check check (admin_pin is null or admin_pin ~ '^[0-9]{4}$'),
  constraint company_settings_admin_pin_hash_check check (admin_pin_hash is null or length(admin_pin_hash) >= 20)
);

create table if not exists public.employees (
  employee_id text primary key default ('emp_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  name text not null,
  role text not null default 'Worker',
  pin text,
  pin_hash text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_pin_check check (pin is null or pin ~ '^[0-9]{4}$'),
  constraint employees_pin_hash_check check (pin_hash is null or length(pin_hash) >= 20),
  constraint employees_status_check check (status in ('active', 'inactive'))
);

create table if not exists public.company_memberships (
  membership_id text primary key default ('mbr_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  employee_id text references public.employees(employee_id) on delete set null,
  role text not null default 'employee',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_memberships_role_check check (role in ('owner', 'admin', 'manager', 'employee')),
  constraint company_memberships_status_check check (status in ('active', 'inactive'))
);

-- RLS helper functions intentionally read company_memberships through
-- security definer execution so policies do not recurse on the membership table.
create or replace function public.current_company_role(target_company_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.company_memberships m
  where m.company_id = target_company_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  order by case m.role
    when 'owner' then 1
    when 'admin' then 2
    when 'manager' then 3
    when 'employee' then 4
    else 5
  end
  limit 1
$$;

create or replace function public.has_company_role(target_company_id text, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.company_id = target_company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed_roles)
  )
$$;

create or replace function public.current_employee_id(target_company_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.employee_id
  from public.company_memberships m
  where m.company_id = target_company_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  order by case m.role
    when 'owner' then 1
    when 'admin' then 2
    when 'manager' then 3
    when 'employee' then 4
    else 5
  end
  limit 1
$$;

create or replace function public.current_employee_name(target_company_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.name
  from public.company_memberships m
  join public.employees e
    on e.employee_id = m.employee_id
   and e.company_id = m.company_id
  where m.company_id = target_company_id
    and m.user_id = auth.uid()
    and m.status = 'active'
    and e.status = 'active'
  order by case m.role
    when 'owner' then 1
    when 'admin' then 2
    when 'manager' then 3
    when 'employee' then 4
    else 5
  end
  limit 1
$$;

create or replace function public.company_has_any_memberships(target_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.company_id = target_company_id
  )
$$;

comment on function public.current_company_role(text)
  is 'Returns the active company_memberships role for auth.uid() within the requested company.';
comment on function public.has_company_role(text, text[])
  is 'Returns true when auth.uid() has an active membership in the requested company with one of the allowed roles.';
comment on function public.current_employee_id(text)
  is 'Returns the employee_id linked to auth.uid() for the requested company, when present.';
comment on function public.current_employee_name(text)
  is 'Returns the active employee name linked to auth.uid() for the requested company, when present.';
comment on function public.company_has_any_memberships(text)
  is 'Security-definer helper used by RLS bootstrap policy to test whether a company already has memberships without recursive policy evaluation.';

create or replace function public.membership_company_matches(target_company_id text, target_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_employee_id is null
    or exists (
      select 1
      from public.employees e
      where e.company_id = target_company_id
        and e.employee_id = target_employee_id
    )
$$;

create or replace function public.property_company_matches(
  target_company_id text,
  target_customer_id text,
  target_service_plan_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customers c
    where c.company_id = target_company_id
      and c.customer_id = target_customer_id
  )
  and (
    target_service_plan_id is null
    or exists (
      select 1
      from public.service_plans sp
      where sp.company_id = target_company_id
        and sp.service_plan_id = target_service_plan_id
    )
  )
$$;

create or replace function public.route_company_matches(target_company_id text, target_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_employee_id is null
    or exists (
      select 1
      from public.employees e
      where e.company_id = target_company_id
        and e.employee_id = target_employee_id
    )
$$;

create or replace function public.visit_company_matches(
  target_company_id text,
  target_property_id text,
  target_route_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.company_id = target_company_id
      and p.property_id = target_property_id
  )
  and (
    target_route_id is null
    or exists (
      select 1
      from public.routes r
      where r.company_id = target_company_id
        and r.route_id = target_route_id
    )
  )
$$;

create or replace function public.route_stop_company_matches(
  target_company_id text,
  target_route_id text,
  target_visit_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.routes r
    where r.company_id = target_company_id
      and r.route_id = target_route_id
  )
  and exists (
    select 1
    from public.visits v
    where v.company_id = target_company_id
      and v.visit_id = target_visit_id
  )
$$;

create or replace function public.shift_company_matches(target_company_id text, target_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.company_id = target_company_id
      and e.employee_id = target_employee_id
  )
$$;

create or replace function public.invoice_company_matches(target_company_id text, target_customer_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customers c
    where c.company_id = target_company_id
      and c.customer_id = target_customer_id
  )
$$;

create or replace function public.invoice_line_item_company_matches(
  target_company_id text,
  target_invoice_id text,
  target_visit_id text,
  target_property_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices i
    where i.company_id = target_company_id
      and i.invoice_id = target_invoice_id
  )
  and (
    target_visit_id is null
    or exists (
      select 1
      from public.visits v
      where v.company_id = target_company_id
        and v.visit_id = target_visit_id
    )
  )
  and (
    target_property_id is null
    or exists (
      select 1
      from public.properties p
      where p.company_id = target_company_id
        and p.property_id = target_property_id
    )
  )
$$;

create or replace function public.payment_company_matches(target_company_id text, target_invoice_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices i
    where i.company_id = target_company_id
      and i.invoice_id = target_invoice_id
  )
$$;

create or replace function public.activity_event_company_matches(
  target_company_id text,
  target_customer_id text,
  target_property_id text,
  target_visit_id text,
  target_invoice_id text,
  target_payment_id text,
  target_employee_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    target_customer_id is null
    or exists (
      select 1
      from public.customers c
      where c.company_id = target_company_id
        and c.customer_id = target_customer_id
    )
  )
  and (
    target_property_id is null
    or exists (
      select 1
      from public.properties p
      where p.company_id = target_company_id
        and p.property_id = target_property_id
    )
  )
  and (
    target_visit_id is null
    or exists (
      select 1
      from public.visits v
      where v.company_id = target_company_id
        and v.visit_id = target_visit_id
    )
  )
  and (
    target_invoice_id is null
    or exists (
      select 1
      from public.invoices i
      where i.company_id = target_company_id
        and i.invoice_id = target_invoice_id
    )
  )
  and (
    target_payment_id is null
    or exists (
      select 1
      from public.payments pmt
      where pmt.company_id = target_company_id
        and pmt.payment_id = target_payment_id
    )
  )
  and (
    target_employee_id is null
    or exists (
      select 1
      from public.employees e
      where e.company_id = target_company_id
        and e.employee_id = target_employee_id
    )
  )
$$;

comment on function public.membership_company_matches(text, text)
  is 'Returns true when a membership employee link is empty or belongs to the same company.';
comment on function public.property_company_matches(text, text, text)
  is 'Returns true when property customer and optional service plan references belong to the same company.';
comment on function public.route_company_matches(text, text)
  is 'Returns true when a route employee link is empty or belongs to the same company.';
comment on function public.visit_company_matches(text, text, text)
  is 'Returns true when visit property and optional route references belong to the same company.';
comment on function public.route_stop_company_matches(text, text, text)
  is 'Returns true when route stop route and visit references belong to the same company.';
comment on function public.shift_company_matches(text, text)
  is 'Returns true when a shift employee reference belongs to the same company.';
comment on function public.invoice_company_matches(text, text)
  is 'Returns true when an invoice customer reference belongs to the same company.';
comment on function public.invoice_line_item_company_matches(text, text, text, text)
  is 'Returns true when invoice line item invoice, visit, and property references belong to the same company.';
comment on function public.payment_company_matches(text, text)
  is 'Returns true when a payment invoice reference belongs to the same company.';
comment on function public.activity_event_company_matches(text, text, text, text, text, text, text)
  is 'Returns true when all optional activity event references belong to the same company.';

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;

drop policy if exists "members can read their company" on public.companies;
create policy "members can read their company"
  on public.companies
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager', 'employee']));

drop policy if exists "authenticated users can create companies" on public.companies;
create policy "authenticated users can create companies"
  on public.companies
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "owners and admins can update their company" on public.companies;
create policy "owners and admins can update their company"
  on public.companies
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "users can read their own active membership" on public.company_memberships;
create policy "users can read their own active membership"
  on public.company_memberships
  for select
  to authenticated
  using (user_id = auth.uid() and status = 'active');

drop policy if exists "owners and admins can read company memberships" on public.company_memberships;
create policy "owners and admins can read company memberships"
  on public.company_memberships
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "authenticated users can create initial owner membership" on public.company_memberships;
create policy "authenticated users can create initial owner membership"
  on public.company_memberships
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and status = 'active'
    and public.membership_company_matches(company_id, employee_id)
    and not public.company_has_any_memberships(company_id)
  );

drop policy if exists "owners can manage company memberships" on public.company_memberships;
create policy "owners can manage company memberships"
  on public.company_memberships
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner']))
  with check (
    public.has_company_role(company_id, array['owner'])
    and public.membership_company_matches(company_id, employee_id)
  );

alter table public.company_settings enable row level security;
alter table public.employees enable row level security;

drop policy if exists "owners admins and managers can read company settings" on public.company_settings;
create policy "owners admins and managers can read company settings"
  on public.company_settings
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners and admins can insert company settings" on public.company_settings;
create policy "owners and admins can insert company settings"
  on public.company_settings
  for insert
  to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners and admins can update company settings" on public.company_settings;
create policy "owners and admins can update company settings"
  on public.company_settings
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners can delete company settings" on public.company_settings;
create policy "owners can delete company settings"
  on public.company_settings
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner']));

drop policy if exists "owners admins and managers can read employees" on public.employees;
create policy "owners admins and managers can read employees"
  on public.employees
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners and admins can insert employees" on public.employees;
create policy "owners and admins can insert employees"
  on public.employees
  for insert
  to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners and admins can update employees" on public.employees;
create policy "owners and admins can update employees"
  on public.employees
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners and admins can delete employees" on public.employees;
create policy "owners and admins can delete employees"
  on public.employees
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

alter table public.company_settings
  add column if not exists admin_pin text;

alter table public.company_settings
  add column if not exists admin_pin_hash text;

alter table public.employees
  add column if not exists pin text;

alter table public.employees
  add column if not exists pin_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_settings_admin_pin_check'
      and conrelid = 'public.company_settings'::regclass
  ) then
    alter table public.company_settings
      add constraint company_settings_admin_pin_check check (admin_pin is null or admin_pin ~ '^[0-9]{4}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_pin_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_pin_check check (pin is null or pin ~ '^[0-9]{4}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_settings_admin_pin_hash_check'
      and conrelid = 'public.company_settings'::regclass
  ) then
    alter table public.company_settings
      add constraint company_settings_admin_pin_hash_check check (admin_pin_hash is null or length(admin_pin_hash) >= 20);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_pin_hash_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_pin_hash_check check (pin_hash is null or length(pin_hash) >= 20);
  end if;
end;
$$;

create table if not exists public.customers (
  customer_id text primary key default ('cust_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  name text not null,
  phone text,
  email text,
  billing_address text,
  notes text,
  customer_notes text,
  billing_notes text,
  preferred_service_day text,
  default_service_location text,
  default_service_frequency text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_status_check check (status in ('active', 'inactive'))
);

alter table public.customers enable row level security;

drop policy if exists "owners admins and managers can read customers" on public.customers;
create policy "owners admins and managers can read customers"
  on public.customers
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can insert customers" on public.customers;
create policy "owners admins and managers can insert customers"
  on public.customers
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
  );

drop policy if exists "owners admins and managers can update customers" on public.customers;
create policy "owners admins and managers can update customers"
  on public.customers
  for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
  );

drop policy if exists "owners and admins can delete customers" on public.customers;
create policy "owners and admins can delete customers"
  on public.customers
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

create table if not exists public.service_plans (
  service_plan_id text primary key default ('plan_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  name text not null,
  service_type text not null,
  recurring_frequency text not null default 'one-time',
  default_price numeric(12, 2) not null default 0,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_plans_default_price_check check (default_price >= 0),
  constraint service_plans_status_check check (status in ('active', 'inactive')),
  constraint service_plans_recurring_frequency_check check (
    recurring_frequency in ('one-time', 'weekly', 'biweekly', 'monthly')
  ),
  constraint service_plans_company_name_key unique (company_id, name)
);

alter table public.service_plans enable row level security;

drop policy if exists "owners admins and managers can read service plans" on public.service_plans;
create policy "owners admins and managers can read service plans"
  on public.service_plans
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can insert service plans" on public.service_plans;
create policy "owners admins and managers can insert service plans"
  on public.service_plans
  for insert
  to authenticated
  with check (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can update service plans" on public.service_plans;
create policy "owners admins and managers can update service plans"
  on public.service_plans
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners and admins can delete service plans" on public.service_plans;
create policy "owners and admins can delete service plans"
  on public.service_plans
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

create table if not exists public.properties (
  property_id text primary key default ('prop_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  customer_id text not null references public.customers(customer_id) on delete restrict,
  service_plan_id text references public.service_plans(service_plan_id) on delete set null,
  service_address text not null,
  service_type text not null,
  recurring_frequency text not null default 'one-time',
  default_price numeric(12, 2) not null default 0,
  notes text,
  gate_code text,
  access_notes text,
  parking_notes text,
  hazards text,
  recurring_schedule jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_default_price_check check (default_price >= 0),
  constraint properties_status_check check (status in ('active', 'inactive')),
  constraint properties_recurring_frequency_check check (
    recurring_frequency in ('one-time', 'weekly', 'biweekly', 'monthly')
  )
);

alter table public.properties
  add column if not exists recurring_schedule jsonb;

alter table public.properties enable row level security;

drop policy if exists "owners admins and managers can read properties" on public.properties;
create policy "owners admins and managers can read properties"
  on public.properties
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can insert properties" on public.properties;
create policy "owners admins and managers can insert properties"
  on public.properties
  for insert
  to authenticated
  with check (
    (
      public.has_company_role(company_id, array['owner', 'admin'])
      or (
        public.has_company_role(company_id, array['manager'])
        and status = 'active'
      )
    )
    and public.property_company_matches(company_id, customer_id, service_plan_id)
  );

drop policy if exists "owners admins and managers can update properties" on public.properties;
create policy "owners admins and managers can update properties"
  on public.properties
  for update
  to authenticated
  using (
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
  )
  with check (
    (
      public.has_company_role(company_id, array['owner', 'admin'])
      or (
        public.has_company_role(company_id, array['manager'])
        and status = 'active'
      )
    )
    and public.property_company_matches(company_id, customer_id, service_plan_id)
  );

drop policy if exists "owners and admins can delete properties" on public.properties;
create policy "owners and admins can delete properties"
  on public.properties
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

create table if not exists public.routes (
  route_id text primary key default ('route_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  name text not null,
  route_day text not null,
  route_date date not null,
  assigned_worker text,
  employee_id text references public.employees(employee_id) on delete set null,
  visit_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routes_route_day_check check (
    route_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  constraint routes_unique_route_key unique (company_id, route_date, route_day, name, assigned_worker)
);

alter table public.routes
  add column if not exists visit_ids jsonb not null default '[]'::jsonb;

create table if not exists public.visits (
  visit_id text primary key default ('visit_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  property_id text not null references public.properties(property_id) on delete restrict,
  visit_date date not null,
  service_description text not null,
  price numeric(12, 2) not null default 0,
  status text not null default 'scheduled',
  notes text,
  started_at timestamptz,
  route_id text,
  route_name text,
  route_day text,
  assigned_worker text,
  worker_name text,
  crew_name text,
  completed_at timestamptz,
  completed_date date,
  completed_late boolean not null default false,
  skip_reason text,
  skipped_at timestamptz,
  rescheduled_to date,
  recurring_generated boolean not null default false,
  holiday_conflict boolean not null default false,
  holiday_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_price_check check (price >= 0),
  constraint visits_status_check check (status in ('scheduled', 'in-progress', 'completed', 'skipped', 'billed'))
);

alter table public.visits
  drop constraint if exists visits_route_id_fkey;

alter table public.visits
  add column if not exists worker_name text,
  add column if not exists crew_name text,
  add column if not exists rescheduled_to date,
  add column if not exists recurring_generated boolean not null default false,
  add column if not exists holiday_conflict boolean not null default false,
  add column if not exists holiday_name text;

create or replace function public.is_assigned_route(target_company_id text, target_route_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.routes r
    where r.company_id = target_company_id
      and r.route_id = target_route_id
      and public.current_employee_id(target_company_id) is not null
      and r.employee_id = public.current_employee_id(target_company_id)
  )
$$;

create or replace function public.is_assigned_visit(target_company_id text, target_visit_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.visits v
    where v.company_id = target_company_id
      and v.visit_id = target_visit_id
      and exists (
        select 1
        from public.routes r
        where r.company_id = v.company_id
          and public.current_employee_id(target_company_id) is not null
          and r.employee_id = public.current_employee_id(target_company_id)
          and (
            r.route_id = v.route_id
            or r.visit_ids ? v.visit_id
          )
      )
  )
$$;

comment on function public.is_assigned_route(text, text)
  is 'Returns true when auth.uid() is assigned to a route through company_memberships.employee_id and routes.employee_id.';
comment on function public.is_assigned_visit(text, text)
  is 'Returns true when auth.uid() is assigned to a visit through a route linked by employee_id.';

create or replace function public.enforce_employee_visit_lifecycle_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_company_role(old.company_id) is distinct from 'employee' then
    return new;
  end if;

  if not public.is_assigned_visit(old.company_id, old.visit_id) then
    raise exception 'Employees can only update assigned visits.';
  end if;

  if new.status not in ('scheduled', 'in-progress', 'completed', 'skipped') then
    raise exception 'Employees can only update visit lifecycle statuses.';
  end if;

  if old.visit_id is distinct from new.visit_id
    or old.company_id is distinct from new.company_id
    or old.property_id is distinct from new.property_id
    or old.visit_date is distinct from new.visit_date
    or old.service_description is distinct from new.service_description
    or old.price is distinct from new.price
    or old.notes is distinct from new.notes
    or old.route_id is distinct from new.route_id
    or old.route_name is distinct from new.route_name
    or old.route_day is distinct from new.route_day
    or old.assigned_worker is distinct from new.assigned_worker
    or old.worker_name is distinct from new.worker_name
    or old.crew_name is distinct from new.crew_name
    or old.recurring_generated is distinct from new.recurring_generated
    or old.holiday_conflict is distinct from new.holiday_conflict
    or old.holiday_name is distinct from new.holiday_name
    or old.created_at is distinct from new.created_at then
    raise exception 'Employees can only update visit lifecycle fields.';
  end if;

  return new;
end;
$$;

alter table public.routes enable row level security;
alter table public.visits enable row level security;

drop policy if exists "owners admins and managers can manage routes" on public.routes;
create policy "owners admins and managers can manage routes"
  on public.routes
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.route_company_matches(company_id, employee_id)
  );

drop policy if exists "employees can read assigned routes" on public.routes;
create policy "employees can read assigned routes"
  on public.routes
  for select
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and public.is_assigned_route(company_id, route_id)
  );

drop policy if exists "owners admins and managers can manage visits" on public.visits;
create policy "owners admins and managers can manage visits"
  on public.visits
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.visit_company_matches(company_id, property_id, route_id)
  );

drop policy if exists "employees can read assigned visits" on public.visits;
create policy "employees can read assigned visits"
  on public.visits
  for select
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and public.is_assigned_visit(company_id, visit_id)
  );

drop policy if exists "employees can update assigned visit lifecycle" on public.visits;
create policy "employees can update assigned visit lifecycle"
  on public.visits
  for update
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and public.is_assigned_visit(company_id, visit_id)
  )
  with check (
    public.current_company_role(company_id) = 'employee'
    and public.is_assigned_visit(company_id, visit_id)
  );

create table if not exists public.route_stops (
  route_stop_id text primary key default ('rs_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  route_id text not null references public.routes(route_id) on delete cascade,
  visit_id text not null references public.visits(visit_id) on delete cascade,
  stop_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_stops_stop_order_check check (stop_order >= 0),
  constraint route_stops_route_visit_key unique (route_id, visit_id)
);

alter table public.route_stops enable row level security;

drop policy if exists "owners admins and managers can manage route stops" on public.route_stops;
create policy "owners admins and managers can manage route stops"
  on public.route_stops
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.route_stop_company_matches(company_id, route_id, visit_id)
  );

drop policy if exists "employees can read assigned route stops" on public.route_stops;
create policy "employees can read assigned route stops"
  on public.route_stops
  for select
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and (
      public.is_assigned_route(company_id, route_id)
      or public.is_assigned_visit(company_id, visit_id)
    )
  );

create table if not exists public.invoices (
  invoice_id text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  customer_id text not null references public.customers(customer_id) on delete restrict,
  invoice_number text not null,
  invoice_sequence integer,
  idempotency_key text,
  invoice_date date not null,
  due_date date not null,
  visit_ids jsonb not null default '[]'::jsonb,
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  payment_status text not null default 'draft',
  amount_paid numeric(12, 2) not null default 0,
  sent_at timestamptz,
  sent_to text,
  delivery_status text not null default 'not_sent',
  customer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_company_invoice_number_key unique (company_id, invoice_number),
  constraint invoices_amounts_check check (
    subtotal >= 0 and tax >= 0 and total >= 0 and amount_paid >= 0
  ),
  constraint invoices_payment_status_check check (
    payment_status in ('draft', 'open', 'sent', 'partial', 'partially_paid', 'paid', 'overdue', 'void', 'cancelled')
  )
);

alter table public.invoices
  add column if not exists visit_ids jsonb not null default '[]'::jsonb;

alter table public.invoices
  add column if not exists invoice_sequence integer;

alter table public.invoices
  add column if not exists idempotency_key text;

alter table public.invoices
  add column if not exists sent_at timestamptz;

alter table public.invoices
  add column if not exists sent_to text;

alter table public.invoices
  add column if not exists delivery_status text not null default 'not_sent';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_delivery_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_delivery_status_check check (
        delivery_status in ('not_sent', 'exported', 'sent', 'failed')
      );
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'invoices_payment_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      drop constraint invoices_payment_status_check;
  end if;

  alter table public.invoices
    add constraint invoices_payment_status_check check (
      payment_status in ('draft', 'open', 'sent', 'partial', 'partially_paid', 'paid', 'overdue', 'void', 'cancelled')
    );
end;
$$;

create table if not exists public.invoice_line_items (
  line_item_id text primary key default ('ili_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  invoice_id text not null references public.invoices(invoice_id) on delete cascade,
  visit_id text references public.visits(visit_id) on delete set null,
  property_id text references public.properties(property_id) on delete set null,
  description text not null,
  amount numeric(12, 2) not null default 0,
  line_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_line_items_amount_check check (amount >= 0),
  constraint invoice_line_items_line_order_check check (line_order >= 0)
);

create table if not exists public.payments (
  payment_id text primary key default ('pay_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  invoice_id text not null references public.invoices(invoice_id) on delete cascade,
  idempotency_key text,
  amount numeric(12, 2) not null,
  payment_date date not null,
  method text not null default 'other',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_check check (amount > 0),
  constraint payments_method_check check (
    method in ('cash', 'check', 'card', 'ach', 'bank_transfer', 'online', 'other')
  )
);

alter table public.payments
  add column if not exists idempotency_key text;

create table if not exists public.company_invoice_counters (
  company_id text primary key references public.companies(company_id) on delete cascade,
  next_invoice_sequence integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_invoice_counters_next_sequence_check check (next_invoice_sequence >= 1)
);

alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.payments enable row level security;
alter table public.company_invoice_counters enable row level security;

drop policy if exists "owners admins and managers can read invoices" on public.invoices;
drop policy if exists "owners and admins can read invoices" on public.invoices;
create policy "owners and admins can read invoices"
  on public.invoices
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can insert invoices" on public.invoices;
drop policy if exists "owners and admins can insert invoices" on public.invoices;
create policy "owners and admins can insert invoices"
  on public.invoices
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.invoice_company_matches(company_id, customer_id)
  );

drop policy if exists "owners admins and managers can update invoices" on public.invoices;
drop policy if exists "owners and admins can update invoices" on public.invoices;
create policy "owners and admins can update invoices"
  on public.invoices
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.invoice_company_matches(company_id, customer_id)
  );

drop policy if exists "owners and admins can delete invoices" on public.invoices;
create policy "owners and admins can delete invoices"
  on public.invoices
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can read invoice line items" on public.invoice_line_items;
drop policy if exists "owners and admins can read invoice line items" on public.invoice_line_items;
create policy "owners and admins can read invoice line items"
  on public.invoice_line_items
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can insert invoice line items" on public.invoice_line_items;
drop policy if exists "owners and admins can insert invoice line items" on public.invoice_line_items;
create policy "owners and admins can insert invoice line items"
  on public.invoice_line_items
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.invoice_line_item_company_matches(company_id, invoice_id, visit_id, property_id)
  );

drop policy if exists "owners admins and managers can update invoice line items" on public.invoice_line_items;
drop policy if exists "owners and admins can update invoice line items" on public.invoice_line_items;
create policy "owners and admins can update invoice line items"
  on public.invoice_line_items
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.invoice_line_item_company_matches(company_id, invoice_id, visit_id, property_id)
  );

drop policy if exists "owners admins and managers can delete invoice line items" on public.invoice_line_items;
drop policy if exists "owners and admins can delete invoice line items" on public.invoice_line_items;
create policy "owners and admins can delete invoice line items"
  on public.invoice_line_items
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can read payments" on public.payments;
drop policy if exists "owners and admins can read payments" on public.payments;
create policy "owners and admins can read payments"
  on public.payments
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can insert payments" on public.payments;
drop policy if exists "owners and admins can insert payments" on public.payments;
create policy "owners and admins can insert payments"
  on public.payments
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.payment_company_matches(company_id, invoice_id)
  );

drop policy if exists "owners admins and managers can update payments" on public.payments;
drop policy if exists "owners and admins can update payments" on public.payments;
create policy "owners and admins can update payments"
  on public.payments
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    and public.payment_company_matches(company_id, invoice_id)
  );

drop policy if exists "owners and admins can delete payments" on public.payments;
create policy "owners and admins can delete payments"
  on public.payments
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can read invoice counters" on public.company_invoice_counters;
drop policy if exists "owners and admins can read invoice counters" on public.company_invoice_counters;
create policy "owners and admins can read invoice counters"
  on public.company_invoice_counters
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "owners admins and managers can manage invoice counters" on public.company_invoice_counters;
drop policy if exists "owners and admins can manage invoice counters" on public.company_invoice_counters;
create policy "owners and admins can manage invoice counters"
  on public.company_invoice_counters
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

create table if not exists public.shifts (
  shift_id text primary key default ('shift_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  employee_id text not null references public.employees(employee_id) on delete cascade,
  employee_name text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_ended_after_started_check check (ended_at is null or ended_at >= started_at)
);

alter table public.shifts enable row level security;

drop policy if exists "owners admins and managers can read shifts" on public.shifts;
create policy "owners admins and managers can read shifts"
  on public.shifts
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can insert shifts" on public.shifts;
create policy "owners admins and managers can insert shifts"
  on public.shifts
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.shift_company_matches(company_id, employee_id)
  );

drop policy if exists "owners admins and managers can update shifts" on public.shifts;
create policy "owners admins and managers can update shifts"
  on public.shifts
  for update
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.shift_company_matches(company_id, employee_id)
  );

drop policy if exists "owners and admins can delete shifts" on public.shifts;
create policy "owners and admins can delete shifts"
  on public.shifts
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists "employees can read own shifts" on public.shifts;
create policy "employees can read own shifts"
  on public.shifts
  for select
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and employee_id = public.current_employee_id(company_id)
  );

drop policy if exists "employees can insert own shifts" on public.shifts;
create policy "employees can insert own shifts"
  on public.shifts
  for insert
  to authenticated
  with check (
    public.current_company_role(company_id) = 'employee'
    and employee_id = public.current_employee_id(company_id)
    and public.shift_company_matches(company_id, employee_id)
  );

drop policy if exists "employees can update own shifts" on public.shifts;
create policy "employees can update own shifts"
  on public.shifts
  for update
  to authenticated
  using (
    public.current_company_role(company_id) = 'employee'
    and employee_id = public.current_employee_id(company_id)
  )
  with check (
    public.current_company_role(company_id) = 'employee'
    and employee_id = public.current_employee_id(company_id)
    and public.shift_company_matches(company_id, employee_id)
  );

create unique index if not exists shifts_one_active_shift_per_employee_idx
  on public.shifts(employee_id)
  where ended_at is null;

create table if not exists public.activity_events (
  activity_event_id text primary key default ('evt_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  customer_id text references public.customers(customer_id) on delete set null,
  property_id text references public.properties(property_id) on delete set null,
  visit_id text references public.visits(visit_id) on delete set null,
  invoice_id text references public.invoices(invoice_id) on delete set null,
  payment_id text references public.payments(payment_id) on delete set null,
  employee_id text references public.employees(employee_id) on delete set null,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.activity_events enable row level security;

drop policy if exists "owners admins and managers can read activity events" on public.activity_events;
create policy "owners admins and managers can read activity events"
  on public.activity_events
  for select
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'manager']));

drop policy if exists "owners admins and managers can insert activity events" on public.activity_events;
create policy "owners admins and managers can insert activity events"
  on public.activity_events
  for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['owner', 'admin', 'manager'])
    and public.activity_event_company_matches(
      company_id,
      customer_id,
      property_id,
      visit_id,
      invoice_id,
      payment_id,
      employee_id
    )
  );

drop policy if exists "owners and admins can delete activity events" on public.activity_events;
create policy "owners and admins can delete activity events"
  on public.activity_events
  for delete
  to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']));

create index if not exists company_settings_company_id_idx on public.company_settings(company_id);

create index if not exists company_memberships_company_id_idx on public.company_memberships(company_id);
create index if not exists company_memberships_user_id_idx on public.company_memberships(user_id);
create index if not exists company_memberships_employee_id_idx on public.company_memberships(employee_id);
create index if not exists company_memberships_company_status_idx on public.company_memberships(company_id, status);
create unique index if not exists company_memberships_company_user_idx
  on public.company_memberships(company_id, user_id)
  where user_id is not null;
create unique index if not exists company_memberships_company_employee_idx
  on public.company_memberships(company_id, employee_id)
  where employee_id is not null;

create index if not exists employees_company_id_idx on public.employees(company_id);
create index if not exists employees_company_status_idx on public.employees(company_id, status);

create index if not exists customers_company_id_idx on public.customers(company_id);
create index if not exists customers_company_status_idx on public.customers(company_id, status);
create index if not exists customers_company_name_idx on public.customers(company_id, name);

create index if not exists service_plans_company_id_idx on public.service_plans(company_id);
create index if not exists service_plans_company_status_idx on public.service_plans(company_id, status);
create index if not exists service_plans_company_service_type_idx on public.service_plans(company_id, service_type);

create index if not exists properties_company_id_idx on public.properties(company_id);
create index if not exists properties_customer_id_idx on public.properties(customer_id);
create index if not exists properties_service_plan_id_idx on public.properties(service_plan_id);
create index if not exists properties_company_status_idx on public.properties(company_id, status);
create index if not exists properties_company_service_type_idx on public.properties(company_id, service_type);

create index if not exists visits_company_id_idx on public.visits(company_id);
create index if not exists visits_property_id_idx on public.visits(property_id);
create index if not exists visits_company_date_idx on public.visits(company_id, visit_date);
create index if not exists visits_company_status_date_idx on public.visits(company_id, status, visit_date);
create index if not exists visits_route_id_idx on public.visits(route_id);

create index if not exists routes_company_date_idx on public.routes(company_id, route_date);
create index if not exists routes_employee_id_idx on public.routes(employee_id);

create index if not exists route_stops_company_id_idx on public.route_stops(company_id);
create index if not exists route_stops_route_order_idx on public.route_stops(route_id, stop_order);
create unique index if not exists route_stops_visit_once_idx on public.route_stops(visit_id);

create index if not exists invoices_company_id_idx on public.invoices(company_id);
create index if not exists invoices_customer_id_idx on public.invoices(customer_id);
create index if not exists invoices_company_status_due_idx on public.invoices(company_id, payment_status, due_date);
create index if not exists invoices_company_invoice_date_idx on public.invoices(company_id, invoice_date);
create unique index if not exists invoices_company_idempotency_customer_idx
  on public.invoices(company_id, idempotency_key, customer_id)
  where idempotency_key is not null;
create unique index if not exists invoices_company_sequence_idx
  on public.invoices(company_id, invoice_sequence)
  where invoice_sequence is not null;

create index if not exists invoice_line_items_company_id_idx on public.invoice_line_items(company_id);
create index if not exists invoice_line_items_invoice_order_idx on public.invoice_line_items(invoice_id, line_order);
create index if not exists invoice_line_items_visit_id_idx on public.invoice_line_items(visit_id);
create unique index if not exists invoice_line_items_company_visit_once_idx
  on public.invoice_line_items(company_id, visit_id)
  where visit_id is not null;

create index if not exists payments_company_id_idx on public.payments(company_id);
create index if not exists payments_invoice_id_idx on public.payments(invoice_id);
create index if not exists payments_company_payment_date_idx on public.payments(company_id, payment_date);
create unique index if not exists payments_company_idempotency_idx
  on public.payments(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists shifts_company_id_idx on public.shifts(company_id);
create index if not exists shifts_employee_started_idx on public.shifts(employee_id, started_at);
create index if not exists shifts_company_started_idx on public.shifts(company_id, started_at);

create index if not exists activity_events_company_occurred_idx on public.activity_events(company_id, occurred_at desc);
create index if not exists activity_events_customer_occurred_idx on public.activity_events(customer_id, occurred_at desc);
create index if not exists activity_events_property_occurred_idx on public.activity_events(property_id, occurred_at desc);
create index if not exists activity_events_visit_occurred_idx on public.activity_events(visit_id, occurred_at desc);
create index if not exists activity_events_invoice_occurred_idx on public.activity_events(invoice_id, occurred_at desc);

create or replace function public.generate_billing_invoices(
  target_company_id text,
  target_visit_ids text[],
  target_idempotency_key text,
  target_invoice_date date default current_date,
  target_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_visit_ids text[];
  existing_invoice_count integer;
  existing_visit_ids text[];
  requested_visit_count integer;
  existing_visit_count integer;
  invoice_prefix text;
  default_due_days integer;
  tax_rate numeric(7, 6);
  customer_record record;
  invoice_record record;
  invoice_id text;
  invoice_sequence integer;
  invoice_number text;
  invoice_subtotal numeric(12, 2);
  invoice_tax numeric(12, 2);
  invoice_total numeric(12, 2);
  created_invoice_ids text[] := array[]::text[];
  billed_visit_ids text[] := array[]::text[];
begin
  if not public.has_company_role(target_company_id, array['owner', 'admin']) then
    raise exception 'Active owner or admin membership is required for billing.';
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    raise exception 'company_id is required.';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency_key is required.';
  end if;

  target_invoice_date := coalesce(target_invoice_date, current_date);

  select coalesce(array_agg(distinct visit_id order by visit_id), array[]::text[])
  into normalized_visit_ids
  from unnest(coalesce(target_visit_ids, array[]::text[])) as visit_id
  where visit_id is not null and btrim(visit_id) <> '';

  requested_visit_count := coalesce(array_length(normalized_visit_ids, 1), 0);
  if requested_visit_count = 0 then
    raise exception 'At least one visit_id is required.';
  end if;

  select count(*)
  into existing_invoice_count
  from public.invoices i
  where i.company_id = target_company_id
    and i.idempotency_key = target_idempotency_key;

  if existing_invoice_count > 0 then
    select coalesce(array_agg(distinct li.visit_id order by li.visit_id), array[]::text[])
    into existing_visit_ids
    from public.invoice_line_items li
    join public.invoices i on i.invoice_id = li.invoice_id
    where i.company_id = target_company_id
      and i.idempotency_key = target_idempotency_key
      and li.visit_id is not null;

    select count(*) into existing_visit_count
    from unnest(existing_visit_ids) existing_id
    where existing_id = any(normalized_visit_ids);

    if coalesce(array_length(existing_visit_ids, 1), 0) <> requested_visit_count
      or existing_visit_count <> requested_visit_count then
      raise exception 'Idempotency key was already used for a different visit set.';
    end if;

    return (
      select jsonb_build_object(
        'idempotent_replay', true,
        'created_count', count(*),
        'billed_visit_count', requested_visit_count,
        'invoice_ids', coalesce(jsonb_agg(i.invoice_id order by i.invoice_number), '[]'::jsonb),
        'invoices', coalesce(jsonb_agg(to_jsonb(i) order by i.invoice_number), '[]'::jsonb)
      )
      from public.invoices i
      where i.company_id = target_company_id
        and i.idempotency_key = target_idempotency_key
    );
  end if;

  select
    coalesce(cs.invoice_prefix, 'FC'),
    coalesce(cs.default_due_days, 15),
    coalesce(cs.tax_rate, 0)
  into invoice_prefix, default_due_days, tax_rate
  from public.company_settings cs
  where cs.company_id = target_company_id
  limit 1;

  if invoice_prefix is null then
    invoice_prefix := 'FC';
    default_due_days := 15;
    tax_rate := 0;
  end if;

  if target_due_date is null then
    target_due_date := target_invoice_date + default_due_days;
  end if;

  insert into public.company_invoice_counters (company_id, next_invoice_sequence)
  values (target_company_id, 1)
  on conflict (company_id) do nothing;

  perform 1
  from public.company_invoice_counters
  where company_id = target_company_id
  for update;

  drop table if exists pg_temp.billing_selected_visits;

  perform 1
  from public.visits v
  where v.company_id = target_company_id
    and v.visit_id = any(normalized_visit_ids)
  for update;

  create temporary table billing_selected_visits on commit drop as
  select
    v.visit_id,
    v.company_id,
    v.property_id,
    v.visit_date,
    v.service_description,
    v.price,
    v.status,
    p.customer_id,
    c.name as customer_name
  from public.visits v
  join public.properties p
    on p.property_id = v.property_id
   and p.company_id = v.company_id
  join public.customers c
    on c.customer_id = p.customer_id
   and c.company_id = v.company_id
  where v.company_id = target_company_id
    and v.visit_id = any(normalized_visit_ids);

  if (select count(*) from billing_selected_visits) <> requested_visit_count then
    raise exception 'One or more visits were not found for this company.';
  end if;

  if exists (select 1 from billing_selected_visits where status <> 'completed') then
    raise exception 'Only completed visits can be invoiced.';
  end if;

  if exists (
    select 1
    from public.invoice_line_items li
    where li.company_id = target_company_id
      and li.visit_id = any(normalized_visit_ids)
  ) then
    raise exception 'One or more visits have already been invoiced.';
  end if;

  for customer_record in
    select
      customer_id,
      max(customer_name) as customer_name,
      coalesce(sum(price), 0)::numeric(12, 2) as subtotal,
      array_agg(visit_id order by visit_date, visit_id) as visit_ids
    from billing_selected_visits
    group by customer_id
    order by customer_id
  loop
    select next_invoice_sequence
    into invoice_sequence
    from public.company_invoice_counters
    where company_id = target_company_id;

    update public.company_invoice_counters
    set next_invoice_sequence = next_invoice_sequence + 1,
        updated_at = now()
    where company_id = target_company_id;

    invoice_id := 'inv_' || replace(gen_random_uuid()::text, '-', '');
    invoice_number := invoice_prefix || '-' || extract(year from target_invoice_date)::int || '-' || lpad(invoice_sequence::text, 4, '0');
    invoice_subtotal := round(customer_record.subtotal, 2);
    invoice_tax := round(invoice_subtotal * tax_rate, 2);
    invoice_total := round(invoice_subtotal + invoice_tax, 2);

    if invoice_subtotal < 0 or invoice_tax < 0 or invoice_total < 0 or invoice_total <> round(invoice_subtotal + invoice_tax, 2) then
      raise exception 'Invoice totals are inconsistent.';
    end if;

    insert into public.invoices (
      invoice_id,
      company_id,
      customer_id,
      invoice_number,
      invoice_sequence,
      idempotency_key,
      invoice_date,
      due_date,
      visit_ids,
      subtotal,
      tax,
      total,
      payment_status,
      amount_paid,
      customer_name
    )
    values (
      invoice_id,
      target_company_id,
      customer_record.customer_id,
      invoice_number,
      invoice_sequence,
      target_idempotency_key,
      target_invoice_date,
      target_due_date,
      to_jsonb(customer_record.visit_ids),
      invoice_subtotal,
      invoice_tax,
      invoice_total,
      'draft',
      0,
      customer_record.customer_name
    )
    returning * into invoice_record;

    insert into public.invoice_line_items (
      line_item_id,
      company_id,
      invoice_id,
      visit_id,
      property_id,
      description,
      amount,
      line_order
    )
    select
      'ili_' || replace(gen_random_uuid()::text, '-', ''),
      target_company_id,
      invoice_id,
      bsv.visit_id,
      bsv.property_id,
      coalesce(bsv.service_description, 'Service visit') || ' (' || bsv.visit_date::text || ')',
      round(coalesce(bsv.price, 0), 2),
      row_number() over (order by bsv.visit_date, bsv.visit_id) - 1
    from billing_selected_visits bsv
    where bsv.customer_id = customer_record.customer_id;

    if (
      select round(coalesce(sum(amount), 0), 2)
      from public.invoice_line_items
      where company_id = target_company_id
        and invoice_id = invoice_record.invoice_id
    ) <> invoice_subtotal then
      raise exception 'Invoice line item total does not match invoice subtotal.';
    end if;

    insert into public.activity_events (
      company_id,
      customer_id,
      invoice_id,
      event_type,
      title,
      detail,
      metadata
    )
    values (
      target_company_id,
      invoice_record.customer_id,
      invoice_record.invoice_id,
      'invoice.created',
      'Invoice created',
      'Invoice ' || invoice_record.invoice_number || ' created from completed visits',
      jsonb_build_object(
        'idempotency_key', target_idempotency_key,
        'invoice_number', invoice_record.invoice_number,
        'visit_ids', customer_record.visit_ids,
        'subtotal', invoice_record.subtotal,
        'tax', invoice_record.tax,
        'total', invoice_record.total
      )
    );

    created_invoice_ids := array_append(created_invoice_ids, invoice_record.invoice_id);
  end loop;

  update public.visits
  set status = 'billed',
      updated_at = now()
  where company_id = target_company_id
    and visit_id = any(normalized_visit_ids);

  billed_visit_ids := normalized_visit_ids;

  return (
    select jsonb_build_object(
      'idempotent_replay', false,
      'created_count', count(*),
      'billed_visit_count', coalesce(array_length(billed_visit_ids, 1), 0),
      'invoice_ids', coalesce(jsonb_agg(i.invoice_id order by i.invoice_number), '[]'::jsonb),
      'invoices', coalesce(jsonb_agg(to_jsonb(i) order by i.invoice_number), '[]'::jsonb)
    )
    from public.invoices i
    where i.company_id = target_company_id
      and i.invoice_id = any(created_invoice_ids)
  );
end;
$$;

comment on function public.generate_billing_invoices(text, text[], text, date, date)
  is 'Atomically creates customer-grouped invoices and line items for completed visits, marks visits billed, and returns idempotent results for retries.';

create or replace function public.invoice_status_for_balance(
  invoice_total numeric,
  amount_paid numeric,
  due_date date,
  current_status text default null
)
returns text
language sql
stable
as $$
  select case
    when current_status in ('void', 'cancelled') then current_status
    when round(coalesce(amount_paid, 0), 2) >= round(coalesce(invoice_total, 0), 2)
      and round(coalesce(invoice_total, 0), 2) > 0 then 'paid'
    when round(coalesce(amount_paid, 0), 2) > 0 then 'partially_paid'
    when due_date is not null and due_date < current_date and current_status not in ('draft') then 'overdue'
    when current_status in ('draft', 'sent', 'open') then current_status
    else 'sent'
  end
$$;

comment on function public.invoice_status_for_balance(numeric, numeric, date, text)
  is 'Returns the durable invoice status from total, paid amount, due date, and current terminal/draft state.';

create or replace function public.record_invoice_payment(
  target_company_id text,
  target_invoice_id text,
  target_amount numeric,
  target_payment_date date,
  target_method text default 'other',
  target_notes text default null,
  target_idempotency_key text default null,
  allow_overpayment boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
  payment_record public.payments%rowtype;
  existing_payment public.payments%rowtype;
  current_paid numeric(12, 2);
  next_paid numeric(12, 2);
  balance_due numeric(12, 2);
  next_status text;
  previous_status text;
begin
  if not public.has_company_role(target_company_id, array['owner', 'admin']) then
    raise exception 'Active owner or admin membership is required for payment recording.';
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    raise exception 'company_id is required.';
  end if;

  if target_invoice_id is null or btrim(target_invoice_id) = '' then
    raise exception 'invoice_id is required.';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency_key is required.';
  end if;

  target_amount := round(coalesce(target_amount, 0), 2);
  if target_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  target_payment_date := coalesce(target_payment_date, current_date);
  target_method := coalesce(nullif(btrim(target_method), ''), 'other');

  select *
  into existing_payment
  from public.payments
  where company_id = target_company_id
    and idempotency_key = target_idempotency_key
  limit 1;

  if found then
    if existing_payment.invoice_id <> target_invoice_id
      or round(existing_payment.amount, 2) <> target_amount
      or existing_payment.payment_date <> target_payment_date
      or coalesce(existing_payment.method, 'other') <> target_method
      or coalesce(existing_payment.notes, '') <> coalesce(target_notes, '') then
      raise exception 'Payment idempotency key was already used for a different payment.';
    end if;

    select *
    into invoice_record
    from public.invoices
    where company_id = target_company_id
      and invoice_id = target_invoice_id;

    return jsonb_build_object(
      'idempotent_replay', true,
      'payment', to_jsonb(existing_payment),
      'invoice', to_jsonb(invoice_record)
    );
  end if;

  select *
  into invoice_record
  from public.invoices
  where company_id = target_company_id
    and invoice_id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice was not found for this company.';
  end if;

  if invoice_record.payment_status in ('void', 'cancelled') then
    raise exception 'Payments cannot be recorded against void or cancelled invoices.';
  end if;

  select round(coalesce(sum(amount), 0), 2)
  into current_paid
  from public.payments
  where company_id = target_company_id
    and invoice_id = target_invoice_id;

  balance_due := round(invoice_record.total - current_paid, 2);
  if not allow_overpayment and target_amount > balance_due then
    raise exception 'Payment exceeds invoice balance.';
  end if;

  insert into public.payments (
    payment_id,
    company_id,
    invoice_id,
    idempotency_key,
    amount,
    payment_date,
    method,
    notes
  )
  values (
    'pay_' || replace(gen_random_uuid()::text, '-', ''),
    target_company_id,
    target_invoice_id,
    target_idempotency_key,
    target_amount,
    target_payment_date,
    target_method,
    target_notes
  )
  returning * into payment_record;

  select round(coalesce(sum(amount), 0), 2)
  into next_paid
  from public.payments
  where company_id = target_company_id
    and invoice_id = target_invoice_id;

  previous_status := invoice_record.payment_status;
  next_status := public.invoice_status_for_balance(
    invoice_record.total,
    next_paid,
    invoice_record.due_date,
    invoice_record.payment_status
  );

  update public.invoices
  set amount_paid = next_paid,
      payment_status = next_status,
      updated_at = now()
  where company_id = target_company_id
    and invoice_id = target_invoice_id
  returning * into invoice_record;

  insert into public.activity_events (
    company_id,
    customer_id,
    invoice_id,
    payment_id,
    event_type,
    title,
    detail,
    metadata
  )
  values (
    target_company_id,
    invoice_record.customer_id,
    invoice_record.invoice_id,
    payment_record.payment_id,
    'payment.recorded',
    'Payment recorded',
    'Payment recorded for invoice ' || invoice_record.invoice_number,
    jsonb_build_object(
      'amount', payment_record.amount,
      'method', payment_record.method,
      'idempotency_key', target_idempotency_key,
      'invoice_status', invoice_record.payment_status,
      'amount_paid', invoice_record.amount_paid
    )
  );

  if previous_status is distinct from invoice_record.payment_status then
    insert into public.activity_events (
      company_id,
      customer_id,
      invoice_id,
      payment_id,
      event_type,
      title,
      detail,
      metadata
    )
    values (
      target_company_id,
      invoice_record.customer_id,
      invoice_record.invoice_id,
      payment_record.payment_id,
      'invoice.status_changed',
      'Invoice status changed',
      'Invoice ' || invoice_record.invoice_number || ' changed from ' || previous_status || ' to ' || invoice_record.payment_status,
      jsonb_build_object(
        'from_status', previous_status,
        'to_status', invoice_record.payment_status,
        'amount_paid', invoice_record.amount_paid,
        'balance', round(invoice_record.total - invoice_record.amount_paid, 2)
      )
    );
  end if;

  return jsonb_build_object(
    'idempotent_replay', false,
    'payment', to_jsonb(payment_record),
    'invoice', to_jsonb(invoice_record)
  );
end;
$$;

comment on function public.record_invoice_payment(text, text, numeric, date, text, text, text, boolean)
  is 'Atomically records an idempotent invoice payment, prevents overpayment by default, updates durable invoice amount/status, and writes audit events.';

create or replace function public.mark_invoice_sent(
  target_company_id text,
  target_invoice_id text,
  target_sent_to text,
  target_delivery_status text default 'sent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
  previous_status text;
  next_status text;
  normalized_delivery_status text;
begin
  if not public.has_company_role(target_company_id, array['owner', 'admin']) then
    raise exception 'Active owner or admin membership is required for invoice delivery.';
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    raise exception 'company_id is required.';
  end if;

  if target_invoice_id is null or btrim(target_invoice_id) = '' then
    raise exception 'invoice_id is required.';
  end if;

  target_sent_to := nullif(btrim(coalesce(target_sent_to, '')), '');
  if target_sent_to is null then
    raise exception 'sent_to is required.';
  end if;

  normalized_delivery_status := coalesce(nullif(btrim(target_delivery_status), ''), 'sent');
  if normalized_delivery_status not in ('exported', 'sent') then
    raise exception 'delivery_status must be exported or sent.';
  end if;

  select *
  into invoice_record
  from public.invoices
  where company_id = target_company_id
    and invoice_id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice was not found for this company.';
  end if;

  if invoice_record.payment_status in ('void', 'cancelled') then
    raise exception 'Void or cancelled invoices cannot be marked sent.';
  end if;

  previous_status := invoice_record.payment_status;
  next_status := case
    when invoice_record.payment_status in ('draft', 'open') then 'sent'
    else invoice_record.payment_status
  end;

  update public.invoices
  set sent_at = coalesce(sent_at, now()),
      sent_to = target_sent_to,
      delivery_status = normalized_delivery_status,
      payment_status = next_status,
      updated_at = now()
  where company_id = target_company_id
    and invoice_id = target_invoice_id
  returning * into invoice_record;

  insert into public.activity_events (
    company_id,
    customer_id,
    invoice_id,
    event_type,
    title,
    detail,
    metadata
  )
  values (
    target_company_id,
    invoice_record.customer_id,
    invoice_record.invoice_id,
    'invoice.sent',
    'Invoice sent',
    'Invoice ' || invoice_record.invoice_number || ' marked sent to ' || target_sent_to,
    jsonb_build_object(
      'sent_to', target_sent_to,
      'sent_at', invoice_record.sent_at,
      'delivery_status', invoice_record.delivery_status,
      'from_status', previous_status,
      'to_status', invoice_record.payment_status
    )
  );

  if previous_status is distinct from invoice_record.payment_status then
    insert into public.activity_events (
      company_id,
      customer_id,
      invoice_id,
      event_type,
      title,
      detail,
      metadata
    )
    values (
      target_company_id,
      invoice_record.customer_id,
      invoice_record.invoice_id,
      'invoice.status_changed',
      'Invoice status changed',
      'Invoice ' || invoice_record.invoice_number || ' changed from ' || previous_status || ' to ' || invoice_record.payment_status,
      jsonb_build_object(
        'from_status', previous_status,
        'to_status', invoice_record.payment_status,
        'delivery_status', invoice_record.delivery_status
      )
    );
  end if;

  return jsonb_build_object('invoice', to_jsonb(invoice_record));
end;
$$;

comment on function public.mark_invoice_sent(text, text, text, text)
  is 'Marks an invoice exported/sent, updates delivery fields and status, and writes invoice delivery audit events.';

create or replace function public.record_invoice_export(
  target_company_id text,
  target_invoice_id text,
  export_format text default 'print'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
begin
  if not public.has_company_role(target_company_id, array['owner', 'admin']) then
    raise exception 'Active owner or admin membership is required for invoice export.';
  end if;

  select *
  into invoice_record
  from public.invoices
  where company_id = target_company_id
    and invoice_id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice was not found for this company.';
  end if;

  if invoice_record.delivery_status = 'not_sent' then
    update public.invoices
    set delivery_status = 'exported',
        updated_at = now()
    where company_id = target_company_id
      and invoice_id = target_invoice_id
    returning * into invoice_record;
  end if;

  insert into public.activity_events (
    company_id,
    customer_id,
    invoice_id,
    event_type,
    title,
    detail,
    metadata
  )
  values (
    target_company_id,
    invoice_record.customer_id,
    invoice_record.invoice_id,
    'invoice.exported',
    'Invoice exported',
    'Invoice ' || invoice_record.invoice_number || ' exported for manual delivery',
    jsonb_build_object(
      'format', coalesce(nullif(btrim(export_format), ''), 'print'),
      'delivery_status', invoice_record.delivery_status
    )
  );

  return jsonb_build_object('invoice', to_jsonb(invoice_record));
end;
$$;

comment on function public.record_invoice_export(text, text, text)
  is 'Writes an invoice export audit event for manual PDF/print delivery workflows.';

create or replace trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create or replace trigger set_company_settings_updated_at
  before update on public.company_settings
  for each row execute function public.set_updated_at();

create or replace trigger set_company_memberships_updated_at
  before update on public.company_memberships
  for each row execute function public.set_updated_at();

create or replace trigger set_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

create or replace trigger set_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create or replace trigger set_service_plans_updated_at
  before update on public.service_plans
  for each row execute function public.set_updated_at();

create or replace trigger set_properties_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

create or replace trigger set_visits_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

create or replace trigger enforce_employee_visit_lifecycle_update
  before update on public.visits
  for each row execute function public.enforce_employee_visit_lifecycle_update();

create or replace trigger set_routes_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

create or replace trigger set_route_stops_updated_at
  before update on public.route_stops
  for each row execute function public.set_updated_at();

create or replace trigger set_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create or replace trigger set_invoice_line_items_updated_at
  before update on public.invoice_line_items
  for each row execute function public.set_updated_at();

create or replace trigger set_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create or replace trigger set_company_invoice_counters_updated_at
  before update on public.company_invoice_counters
  for each row execute function public.set_updated_at();

create or replace trigger set_shifts_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

create or replace trigger set_activity_events_updated_at
  before update on public.activity_events
  for each row execute function public.set_updated_at();

commit;
