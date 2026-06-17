-- FieldCore Service production schema for Supabase.
-- Paste this file into the Supabase SQL Editor and run it as one script.
-- RLS policies are intentionally limited to company, membership, settings,
-- employee, service plan, customer, and property tables in this phase.

begin;

create extension if not exists pgcrypto;

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
comment on function public.company_has_any_memberships(text)
  is 'Security-definer helper used by RLS bootstrap policy to test whether a company already has memberships without recursive policy evaluation.';

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
    and not public.company_has_any_memberships(company_id)
  );

drop policy if exists "owners can manage company memberships" on public.company_memberships;
create policy "owners can manage company memberships"
  on public.company_memberships
  for all
  to authenticated
  using (public.has_company_role(company_id, array['owner']))
  with check (public.has_company_role(company_id, array['owner']));

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
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
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
    public.has_company_role(company_id, array['owner', 'admin'])
    or (
      public.has_company_role(company_id, array['manager'])
      and status = 'active'
    )
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

create table if not exists public.invoices (
  invoice_id text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies(company_id) on delete cascade,
  customer_id text not null references public.customers(customer_id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  due_date date not null,
  visit_ids jsonb not null default '[]'::jsonb,
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  payment_status text not null default 'draft',
  amount_paid numeric(12, 2) not null default 0,
  customer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_company_invoice_number_key unique (company_id, invoice_number),
  constraint invoices_amounts_check check (
    subtotal >= 0 and tax >= 0 and total >= 0 and amount_paid >= 0
  ),
  constraint invoices_payment_status_check check (
    payment_status in ('draft', 'sent', 'partial', 'paid', 'overdue', 'void')
  )
);

alter table public.invoices
  add column if not exists visit_ids jsonb not null default '[]'::jsonb;

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

create index if not exists invoice_line_items_company_id_idx on public.invoice_line_items(company_id);
create index if not exists invoice_line_items_invoice_order_idx on public.invoice_line_items(invoice_id, line_order);
create index if not exists invoice_line_items_visit_id_idx on public.invoice_line_items(visit_id);

create index if not exists payments_company_id_idx on public.payments(company_id);
create index if not exists payments_invoice_id_idx on public.payments(invoice_id);
create index if not exists payments_company_payment_date_idx on public.payments(company_id, payment_date);

create index if not exists shifts_company_id_idx on public.shifts(company_id);
create index if not exists shifts_employee_started_idx on public.shifts(employee_id, started_at);
create index if not exists shifts_company_started_idx on public.shifts(company_id, started_at);

create index if not exists activity_events_company_occurred_idx on public.activity_events(company_id, occurred_at desc);
create index if not exists activity_events_customer_occurred_idx on public.activity_events(customer_id, occurred_at desc);
create index if not exists activity_events_property_occurred_idx on public.activity_events(property_id, occurred_at desc);
create index if not exists activity_events_visit_occurred_idx on public.activity_events(visit_id, occurred_at desc);
create index if not exists activity_events_invoice_occurred_idx on public.activity_events(invoice_id, occurred_at desc);

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

create or replace trigger set_shifts_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

create or replace trigger set_activity_events_updated_at
  before update on public.activity_events
  for each row execute function public.set_updated_at();

commit;
