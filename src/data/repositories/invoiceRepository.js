import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

export function listInvoices() {
  return clone(readState().invoices || []);
}

export function getInvoice(invoiceId) {
  const invoice = (readState().invoices || []).find((item) => item.invoice_id === invoiceId);
  return cloneOrNull(invoice);
}

export function listOpenInvoices() {
  return listInvoices().filter((invoice) => (invoice.payment_status || '') !== 'paid');
}

export function createInvoices(invoices, metadata = {}) {
  if (!invoices.length) return [];

  const state = readState();
  const nextInvoices = clone(invoices);

  const nextState = {
    ...state,
    invoices: [...(state.invoices || []), ...nextInvoices]
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'invoice:create-many',
    invoice_ids: nextInvoices.map((invoice) => invoice.invoice_id)
  });

  emit('invoices:changed', {
    action: metadata.eventAction || metadata.action || 'create-many',
    invoice_ids: nextInvoices.map((invoice) => invoice.invoice_id),
    invoices: clone(nextInvoices),
    metadata: clone(metadata)
  });

  return clone(nextInvoices);
}

export function updateInvoicePaymentFields(invoiceId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedInvoice = null;

  const nextState = {
    ...state,
    invoices: (state.invoices || []).map((invoice) => {
      if (invoice.invoice_id !== invoiceId) return invoice;
      updatedInvoice = {
        ...invoice,
        ...patch
      };
      return updatedInvoice;
    })
  };

  if (!updatedInvoice) return null;

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'invoice:update-payment-fields',
    invoice_id: invoiceId
  });

  emit('invoices:changed', {
    action: metadata.eventAction || metadata.action || 'update-payment-fields',
    invoice_id: invoiceId,
    invoice: clone(updatedInvoice),
    metadata: clone(metadata)
  });

  return clone(updatedInvoice);
}
