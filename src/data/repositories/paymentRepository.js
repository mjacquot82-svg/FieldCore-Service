import { emit } from '../appEventBus.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const PAYMENT_FIELDS = [
  'payment_id',
  'company_id',
  'invoice_id',
  'amount',
  'payment_date',
  'method',
  'notes',
  'created_at',
  'updated_at'
];

const PAYMENT_SELECT_FIELDS = PAYMENT_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makePaymentId() {
  return `pay_${crypto.randomUUID().slice(0, 8)}`;
}

function localPayments() {
  return readState().payments || [];
}

function writeLocalPayments(payments, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    payments
  };

  writeState(nextState, metadata);
  return payments;
}

function normalizePaymentFromSupabase(payment) {
  if (!payment) return null;
  return {
    ...payment,
    amount: Number(payment.amount ?? 0)
  };
}

function normalizePaymentForSupabase(payment) {
  return PAYMENT_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(payment, field)) {
      record[field] = payment[field] ?? null;
    }
    return record;
  }, {
    payment_id: payment.payment_id,
    company_id: payment.company_id,
    invoice_id: payment.invoice_id,
    amount: Number(payment.amount ?? 0),
    payment_date: payment.payment_date,
    method: payment.method || 'other'
  });
}

async function readSupabasePayments(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('payments', {
    select: PAYMENT_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'payment_date.desc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizePaymentFromSupabase));
}

async function writeSupabasePayment(payment) {
  const record = normalizePaymentForSupabase(payment);
  if (!record.payment_id || !record.company_id || !record.invoice_id || !record.payment_date) return null;

  const response = await supabaseUpsert('payments', record, {
    onConflict: 'payment_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(normalizePaymentFromSupabase(response.data[0]));
}

async function writeSupabasePayments(payments) {
  const records = payments.map(normalizePaymentForSupabase).filter((payment) => (
    payment.payment_id && payment.company_id && payment.invoice_id && payment.payment_date
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('payments', records, {
    onConflict: 'payment_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizePaymentFromSupabase));
}

export async function syncPaymentsFromSupabase() {
  const state = readState();
  const payments = await readSupabasePayments(state.company?.company_id);
  if (!payments) return null;

  if (!payments.length && (state.payments || []).length) {
    const bootstrappedPayments = await writeSupabasePayments(state.payments || []);
    if (!bootstrappedPayments) return null;

    writeLocalPayments(bootstrappedPayments, {
      action: 'payments:bootstrap-supabase'
    });

    return clone(bootstrappedPayments);
  }

  writeLocalPayments(payments, {
    action: 'payments:sync-from-supabase'
  });

  return clone(payments);
}

export function listPayments() {
  return clone(localPayments());
}

export async function listPaymentsAsync() {
  const state = readState();
  const payments = await readSupabasePayments(state.company?.company_id);
  return payments || listPayments();
}

export function listPaymentsByInvoice(invoiceId) {
  return listPayments().filter((payment) => payment.invoice_id === invoiceId);
}

export async function createPayment(paymentInput = {}, metadata = {}) {
  const state = readState();
  const payment = {
    payment_id: paymentInput.payment_id || makePaymentId(),
    company_id: paymentInput.company_id || state.company?.company_id,
    invoice_id: paymentInput.invoice_id,
    amount: Number(paymentInput.amount ?? 0),
    payment_date: paymentInput.payment_date || new Date().toISOString().slice(0, 10),
    method: paymentInput.method || 'other',
    notes: paymentInput.notes,
    created_at: paymentInput.created_at || new Date().toISOString()
  };

  const persistedPayment = (await writeSupabasePayment(payment)) || payment;
  writeLocalPayments([...(state.payments || []), persistedPayment], {
    ...metadata,
    action: metadata.action || 'payment:create',
    payment_id: persistedPayment.payment_id
  });

  emit('payments:changed', {
    action: metadata.eventAction || metadata.action || 'create',
    payment_id: persistedPayment.payment_id,
    payment: clone(persistedPayment),
    metadata: clone(metadata)
  });

  return clone(persistedPayment);
}

export async function updatePayment(paymentId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedPayment = null;

  const nextPayments = (state.payments || []).map((payment) => {
    if (payment.payment_id !== paymentId) return payment;
    updatedPayment = {
      ...payment,
      ...patch
    };
    return updatedPayment;
  });

  if (!updatedPayment) return null;
  const persistedPayment = (await writeSupabasePayment(updatedPayment)) || updatedPayment;
  const persistedPayments = nextPayments.map((payment) => (
    payment.payment_id === paymentId ? persistedPayment : payment
  ));

  writeLocalPayments(persistedPayments, {
    ...metadata,
    action: metadata.action || 'payment:update',
    payment_id: paymentId
  });

  emit('payments:changed', {
    action: metadata.eventAction || metadata.action || 'update',
    payment_id: paymentId,
    payment: clone(persistedPayment),
    metadata: clone(metadata)
  });

  return clone(persistedPayment);
}
