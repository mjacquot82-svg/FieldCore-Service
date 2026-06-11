import { emit } from '../data/appEventBus.js';
import { getInvoice, updateInvoicePaymentFields } from '../data/repositories/invoiceRepository.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function emitPaymentsChanged(invoice, metadata) {
  emit('payments:changed', {
    action: metadata.eventAction || metadata.action || 'invoice-payment-status-updated',
    invoice_id: invoice.invoice_id,
    invoice: clone(invoice),
    metadata: clone(metadata)
  });
}

export function updateInvoicePaymentStatus(invoiceId, nextStatus, metadata = {}) {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return null;

  const patch = { payment_status: nextStatus };

  if (nextStatus === 'paid') {
    patch.amount_paid = invoice.total;
  }

  if (nextStatus === 'partial') {
    patch.amount_paid = Number((invoice.total / 2).toFixed(2));
  }

  const updatedInvoice = updateInvoicePaymentFields(invoiceId, patch, {
    ...metadata,
    action: metadata.action || 'payment:update-invoice-status',
    eventAction: metadata.eventAction || 'payment-status-updated',
    payment_status: nextStatus
  });

  if (!updatedInvoice) return null;

  emitPaymentsChanged(updatedInvoice, {
    ...metadata,
    action: metadata.action || 'payment:update-invoice-status',
    eventAction: metadata.eventAction || 'payment-status-updated',
    payment_status: nextStatus
  });

  return updatedInvoice;
}

export function markInvoicePaid(invoiceId, metadata = {}) {
  return updateInvoicePaymentStatus(invoiceId, 'paid', {
    ...metadata,
    action: metadata.action || 'payment:mark-paid',
    eventAction: metadata.eventAction || 'mark-paid'
  });
}

export function markInvoicePartial(invoiceId, metadata = {}) {
  return updateInvoicePaymentStatus(invoiceId, 'partial', {
    ...metadata,
    action: metadata.action || 'payment:mark-partial',
    eventAction: metadata.eventAction || 'mark-partial'
  });
}
