import { emit } from '../data/appEventBus.js';
import { getInvoice, updateInvoicePaymentFields } from '../data/repositories/invoiceRepository.js';
import { createPayment, listPaymentsByInvoice } from '../data/repositories/paymentRepository.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function roundCurrency(amount) {
  return Number(Number(amount || 0).toFixed(2));
}

function getPaymentTotal(invoiceId) {
  return roundCurrency(
    listPaymentsByInvoice(invoiceId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
}

function getPaymentStatus(invoice, amountPaid, requestedStatus) {
  const total = roundCurrency(invoice.total);
  if (amountPaid >= total && total > 0) return 'paid';
  if (amountPaid > 0) return 'partial';
  return requestedStatus === 'paid' ? 'paid' : requestedStatus;
}

function emitPaymentsChanged(invoice, metadata) {
  emit('payments:changed', {
    action: metadata.eventAction || metadata.action || 'invoice-payment-status-updated',
    invoice_id: invoice.invoice_id,
    invoice: clone(invoice),
    metadata: clone(metadata)
  });
}

export async function updateInvoicePaymentStatus(invoiceId, nextStatus, metadata = {}) {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return null;

  const targetAmount = nextStatus === 'paid'
    ? roundCurrency(invoice.total)
    : roundCurrency(Number(invoice.total || 0) / 2);
  const existingPaymentTotal = getPaymentTotal(invoiceId);
  const paymentDelta = roundCurrency(targetAmount - existingPaymentTotal);

  if (paymentDelta > 0) {
    await createPayment({
      invoice_id: invoiceId,
      amount: paymentDelta,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'other',
      notes: `Recorded from ${nextStatus} invoice action.`
    }, {
      ...metadata,
      action: metadata.action || 'payment:record-from-invoice-status',
      eventAction: metadata.eventAction || 'payment-recorded-from-invoice-status',
      invoice_id: invoiceId,
      payment_status: nextStatus
    });
  }

  const amountPaid = Math.min(roundCurrency(invoice.total), Math.max(targetAmount, getPaymentTotal(invoiceId)));
  const patch = {
    amount_paid: amountPaid,
    payment_status: getPaymentStatus(invoice, amountPaid, nextStatus)
  };

  const updatedInvoice = await updateInvoicePaymentFields(invoiceId, patch, {
    ...metadata,
    action: metadata.action || 'payment:update-invoice-status',
    eventAction: metadata.eventAction || 'payment-status-updated',
    payment_status: patch.payment_status,
    amount_paid: amountPaid
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
