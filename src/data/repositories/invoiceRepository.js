import { emit } from '../appEventBus.js';
import { supabaseDelete, supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const INVOICE_FIELDS = [
  'invoice_id',
  'company_id',
  'customer_id',
  'invoice_number',
  'invoice_date',
  'due_date',
  'visit_ids',
  'subtotal',
  'tax',
  'total',
  'payment_status',
  'amount_paid',
  'customer_name',
  'created_at',
  'updated_at'
];

const LINE_ITEM_FIELDS = [
  'line_item_id',
  'company_id',
  'invoice_id',
  'visit_id',
  'property_id',
  'description',
  'amount',
  'line_order',
  'created_at',
  'updated_at'
];

const INVOICE_SELECT_FIELDS = INVOICE_FIELDS.join(',');
const LINE_ITEM_SELECT_FIELDS = LINE_ITEM_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function localInvoices() {
  return readState().invoices || [];
}

function writeLocalInvoices(invoices, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    invoices
  };

  writeState(nextState, metadata);
  return invoices;
}

function normalizeInvoiceFromSupabase(invoice, lineItemsByInvoice = {}) {
  if (!invoice) return null;
  const lineItems = lineItemsByInvoice[invoice.invoice_id] || [];
  return {
    ...invoice,
    visit_ids: Array.isArray(invoice.visit_ids)
      ? invoice.visit_ids
      : lineItems.map((item) => item.visit_id).filter(Boolean),
    line_items: lineItems.map((item) => ({
      visit_id: item.visit_id,
      property_id: item.property_id,
      description: item.description,
      amount: Number(item.amount ?? 0)
    })),
    subtotal: Number(invoice.subtotal ?? 0),
    tax: Number(invoice.tax ?? 0),
    total: Number(invoice.total ?? 0),
    amount_paid: Number(invoice.amount_paid ?? 0)
  };
}

function normalizeInvoiceForSupabase(invoice) {
  return INVOICE_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(invoice, field)) {
      record[field] = invoice[field] ?? null;
    }
    return record;
  }, {
    invoice_id: invoice.invoice_id,
    company_id: invoice.company_id,
    customer_id: invoice.customer_id,
    invoice_number: invoice.invoice_number || '',
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    visit_ids: Array.isArray(invoice.visit_ids) ? invoice.visit_ids : [],
    subtotal: Number(invoice.subtotal ?? 0),
    tax: Number(invoice.tax ?? 0),
    total: Number(invoice.total ?? 0),
    payment_status: invoice.payment_status || 'draft',
    amount_paid: Number(invoice.amount_paid ?? 0)
  });
}

function normalizeLineItemForSupabase(invoice, item, index) {
  return LINE_ITEM_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      record[field] = item[field] ?? null;
    }
    return record;
  }, {
    line_item_id: item.line_item_id || `ili_${invoice.invoice_id}_${index + 1}`,
    company_id: invoice.company_id,
    invoice_id: invoice.invoice_id,
    visit_id: item.visit_id || null,
    property_id: item.property_id || null,
    description: item.description || '',
    amount: Number(item.amount ?? 0),
    line_order: index
  });
}

function groupLineItems(lineItems) {
  return (lineItems || []).reduce((groups, item) => {
    if (!groups[item.invoice_id]) groups[item.invoice_id] = [];
    groups[item.invoice_id].push(item);
    groups[item.invoice_id].sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0));
    return groups;
  }, {});
}

async function readSupabaseLineItems(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('invoice_line_items', {
    select: LINE_ITEM_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'line_order.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function readSupabaseInvoices(companyId) {
  if (!companyId) return null;

  const [invoiceResponse, lineItems] = await Promise.all([
    supabaseSelect('invoices', {
      select: INVOICE_SELECT_FIELDS,
      company_id: `eq.${companyId}`,
      order: 'invoice_date.desc'
    }),
    readSupabaseLineItems(companyId)
  ]);

  if (!invoiceResponse.configured || invoiceResponse.error || !Array.isArray(invoiceResponse.data)) return null;
  if (!lineItems) return null;

  const lineItemsByInvoice = groupLineItems(lineItems);
  return clone(invoiceResponse.data.map((invoice) => normalizeInvoiceFromSupabase(invoice, lineItemsByInvoice)));
}

async function readSupabaseInvoice(invoiceId) {
  const state = readState();
  if (!state.company?.company_id) return null;

  const [invoiceResponse, lineItemResponse] = await Promise.all([
    supabaseSelect('invoices', {
      select: INVOICE_SELECT_FIELDS,
      company_id: `eq.${state.company.company_id}`,
      invoice_id: `eq.${invoiceId}`,
      limit: '1'
    }),
    supabaseSelect('invoice_line_items', {
      select: LINE_ITEM_SELECT_FIELDS,
      company_id: `eq.${state.company.company_id}`,
      invoice_id: `eq.${invoiceId}`,
      order: 'line_order.asc'
    })
  ]);

  if (!invoiceResponse.configured || invoiceResponse.error || !Array.isArray(invoiceResponse.data)) return null;
  if (!lineItemResponse.configured || lineItemResponse.error || !Array.isArray(lineItemResponse.data)) return null;

  return cloneOrNull(normalizeInvoiceFromSupabase(
    invoiceResponse.data[0],
    groupLineItems(lineItemResponse.data)
  ));
}

async function writeSupabaseInvoiceLineItems(invoice) {
  if (!invoice.invoice_id || !invoice.company_id) return null;

  await supabaseDelete('invoice_line_items', {
    company_id: `eq.${invoice.company_id}`,
    invoice_id: `eq.${invoice.invoice_id}`
  });

  const records = (invoice.line_items || []).map((item, index) => normalizeLineItemForSupabase(invoice, item, index));
  if (!records.length) return [];

  const response = await supabaseUpsert('invoice_line_items', records, {
    onConflict: 'line_item_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function writeSupabaseInvoice(invoice) {
  const record = normalizeInvoiceForSupabase(invoice);
  if (!record.invoice_id || !record.company_id || !record.customer_id) return null;

  const response = await supabaseUpsert('invoices', record, {
    onConflict: 'invoice_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;

  const lineItems = await writeSupabaseInvoiceLineItems(invoice);
  if (!lineItems) return null;

  return normalizeInvoiceFromSupabase(response.data[0], groupLineItems(lineItems));
}

async function writeSupabaseInvoices(invoices) {
  const records = invoices.map(normalizeInvoiceForSupabase).filter((invoice) => (
    invoice.invoice_id && invoice.company_id && invoice.customer_id
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('invoices', records, {
    onConflict: 'invoice_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;

  const allLineItems = [];
  for (const invoice of invoices) {
    const lineItems = await writeSupabaseInvoiceLineItems(invoice);
    if (lineItems === null) return null;
    allLineItems.push(...lineItems);
  }

  const lineItemsByInvoice = groupLineItems(allLineItems);
  return clone(response.data.map((invoice) => normalizeInvoiceFromSupabase(invoice, lineItemsByInvoice)));
}

export async function syncInvoicesFromSupabase() {
  const state = readState();
  const invoices = await readSupabaseInvoices(state.company?.company_id);
  if (!invoices) return null;

  if (!invoices.length && (state.invoices || []).length) {
    const bootstrappedInvoices = await writeSupabaseInvoices(state.invoices || []);
    if (!bootstrappedInvoices) return null;

    writeLocalInvoices(bootstrappedInvoices, {
      action: 'invoices:bootstrap-supabase'
    });

    return clone(bootstrappedInvoices);
  }

  writeLocalInvoices(invoices, {
    action: 'invoices:sync-from-supabase'
  });

  return clone(invoices);
}

export function listInvoices() {
  return clone(localInvoices());
}

export async function listInvoicesAsync() {
  const state = readState();
  const invoices = await readSupabaseInvoices(state.company?.company_id);
  return invoices || listInvoices();
}

export function getInvoice(invoiceId) {
  const invoice = localInvoices().find((item) => item.invoice_id === invoiceId);
  return cloneOrNull(invoice);
}

export async function getInvoiceAsync(invoiceId) {
  const invoice = await readSupabaseInvoice(invoiceId);
  return invoice || getInvoice(invoiceId);
}

export function listOpenInvoices() {
  return listInvoices().filter((invoice) => (invoice.payment_status || '') !== 'paid');
}

export async function createInvoices(invoices, metadata = {}) {
  if (!invoices.length) return [];

  const state = readState();
  const nextInvoices = clone(invoices).map((invoice) => ({
    ...invoice,
    company_id: invoice.company_id || state.company?.company_id
  }));
  const persistedInvoices = (await writeSupabaseInvoices(nextInvoices)) || nextInvoices;

  writeLocalInvoices([...(state.invoices || []), ...persistedInvoices], {
    ...metadata,
    action: metadata.action || 'invoice:create-many',
    invoice_ids: persistedInvoices.map((invoice) => invoice.invoice_id)
  });

  emit('invoices:changed', {
    action: metadata.eventAction || metadata.action || 'create-many',
    invoice_ids: persistedInvoices.map((invoice) => invoice.invoice_id),
    invoices: clone(persistedInvoices),
    metadata: clone(metadata)
  });

  return clone(persistedInvoices);
}

export async function updateInvoicePaymentFields(invoiceId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedInvoice = null;

  const invoices = state.invoices || [];
  const nextInvoices = invoices.map((invoice) => {
    if (invoice.invoice_id !== invoiceId) return invoice;
    updatedInvoice = {
      ...invoice,
      ...patch
    };
    return updatedInvoice;
  });

  if (!updatedInvoice) return null;
  const persistedInvoice = (await writeSupabaseInvoice(updatedInvoice)) || updatedInvoice;
  const persistedInvoices = nextInvoices.map((invoice) => (
    invoice.invoice_id === invoiceId ? persistedInvoice : invoice
  ));

  writeLocalInvoices(persistedInvoices, {
    ...metadata,
    action: metadata.action || 'invoice:update-payment-fields',
    invoice_id: invoiceId
  });

  emit('invoices:changed', {
    action: metadata.eventAction || metadata.action || 'update-payment-fields',
    invoice_id: invoiceId,
    invoice: clone(persistedInvoice),
    metadata: clone(metadata)
  });

  return clone(persistedInvoice);
}
