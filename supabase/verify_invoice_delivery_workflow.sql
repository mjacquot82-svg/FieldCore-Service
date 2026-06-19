begin;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';

insert into public.companies (company_id, name)
values ('co_invoice_delivery_a', 'Invoice Delivery Verification')
on conflict (company_id) do nothing;

insert into public.customers (customer_id, company_id, name, email, status)
values ('cust_invoice_delivery_a', 'co_invoice_delivery_a', 'Delivery Customer', 'billing@example.test', 'active')
on conflict (customer_id) do update set email = excluded.email;

insert into public.company_memberships (
  membership_id,
  company_id,
  user_id,
  role,
  status
)
values (
  'mship_invoice_delivery_owner',
  'co_invoice_delivery_a',
  '00000000-0000-0000-0000-000000000011',
  'owner',
  'active'
)
on conflict (membership_id) do update
set user_id = excluded.user_id,
    role = excluded.role,
    status = excluded.status;

insert into public.invoices (
  invoice_id,
  company_id,
  customer_id,
  invoice_number,
  invoice_date,
  due_date,
  subtotal,
  tax,
  total,
  payment_status,
  amount_paid,
  customer_name
)
values (
  'inv_delivery_verify',
  'co_invoice_delivery_a',
  'cust_invoice_delivery_a',
  'DEL-VERIFY-1',
  current_date,
  current_date + 14,
  100,
  0,
  100,
  'draft',
  0,
  'Delivery Customer'
)
on conflict (invoice_id) do update
set payment_status = 'draft',
    delivery_status = 'not_sent',
    sent_at = null,
    sent_to = null,
    amount_paid = 0;

select public.record_invoice_export(
  'co_invoice_delivery_a',
  'inv_delivery_verify',
  'print'
);

do $$
declare
  invoice_record public.invoices%rowtype;
begin
  select * into invoice_record
  from public.invoices
  where invoice_id = 'inv_delivery_verify';

  if invoice_record.delivery_status <> 'exported' then
    raise exception 'Expected delivery_status exported after export, got %', invoice_record.delivery_status;
  end if;
end;
$$;

select public.mark_invoice_sent(
  'co_invoice_delivery_a',
  'inv_delivery_verify',
  'billing@example.test',
  'sent'
);

do $$
declare
  invoice_record public.invoices%rowtype;
  event_count integer;
begin
  select * into invoice_record
  from public.invoices
  where invoice_id = 'inv_delivery_verify';

  if invoice_record.payment_status <> 'sent' then
    raise exception 'Expected payment_status sent, got %', invoice_record.payment_status;
  end if;

  if invoice_record.delivery_status <> 'sent' then
    raise exception 'Expected delivery_status sent, got %', invoice_record.delivery_status;
  end if;

  if invoice_record.sent_at is null or invoice_record.sent_to <> 'billing@example.test' then
    raise exception 'Expected sent_at and sent_to to be stored.';
  end if;

  select count(*) into event_count
  from public.activity_events
  where company_id = 'co_invoice_delivery_a'
    and invoice_id = 'inv_delivery_verify'
    and event_type in ('invoice.exported', 'invoice.sent', 'invoice.status_changed');

  if event_count < 3 then
    raise exception 'Expected invoice delivery audit events, got %', event_count;
  end if;
end;
$$;

rollback;
