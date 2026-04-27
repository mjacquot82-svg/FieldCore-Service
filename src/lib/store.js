import { seedData } from '../data/seed.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = clone(seedData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(raw);
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetSeed() {
  const seeded = clone(seedData);
  saveState(seeded);
  return seeded;
}

export function getCustomerMap(state) {
  return Object.fromEntries(state.customers.map((customer) => [customer.customer_id, customer]));
}

export function getPropertyMap(state) {
  return Object.fromEntries(state.properties.map((property) => [property.property_id, property]));
}

export function generateBatchInvoices(state, startDate, endDate) {
  const propertyMap = getPropertyMap(state);
  const customerMap = getCustomerMap(state);
  const taxRate = state.settings.tax_rate ?? 0;

  const eligibleVisits = state.visits.filter((visit) => {
    if (visit.status !== 'completed') return false;
    if (visit.visit_date < startDate || visit.visit_date > endDate) return false;
    const property = propertyMap[visit.property_id];
    return Boolean(property?.customer_id);
  });

  const grouped = eligibleVisits.reduce((acc, visit) => {
    const customerId = propertyMap[visit.property_id].customer_id;
    if (!acc[customerId]) acc[customerId] = [];
    acc[customerId].push(visit);
    return acc;
  }, {});

  const newInvoices = [];
  const touchedVisitIds = new Set();

  Object.entries(grouped).forEach(([customerId, visits], index) => {
    const subtotal = visits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax).toFixed(2));
    const sequence = String(state.invoices.length + index + 1).padStart(4, '0');
    const invoiceNumber = `${state.settings.invoice_prefix}-${new Date().getFullYear()}-${sequence}`;

    newInvoices.push({
      invoice_id: `inv_${crypto.randomUUID().slice(0, 8)}`,
      company_id: state.company.company_id,
      customer_id: customerId,
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: addDays(new Date(), state.settings.default_due_days).toISOString().slice(0, 10),
      line_items: visits.map((visit) => ({
        visit_id: visit.visit_id,
        property_id: visit.property_id,
        description: `${visit.service_description} (${visit.visit_date})`,
        amount: visit.price
      })),
      subtotal,
      tax,
      total,
      payment_status: 'draft',
      amount_paid: 0,
      created_at: new Date().toISOString(),
      customer_name: customerMap[customerId]?.name ?? 'Unknown Customer'
    });

    visits.forEach((visit) => touchedVisitIds.add(visit.visit_id));
  });

  state.visits = state.visits.map((visit) =>
    touchedVisitIds.has(visit.visit_id) ? { ...visit, status: 'billed' } : visit
  );
  state.invoices = [...state.invoices, ...newInvoices];

  return {
    createdCount: newInvoices.length,
    billedVisitCount: touchedVisitIds.size,
    invoices: newInvoices
  };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function updateInvoicePaymentStatus(state, invoiceId, nextStatus) {
  state.invoices = state.invoices.map((invoice) => {
    if (invoice.invoice_id !== invoiceId) return invoice;

    if (nextStatus === 'paid') {
      return { ...invoice, payment_status: 'paid', amount_paid: invoice.total };
    }

    if (nextStatus === 'partial') {
      const partial = Number((invoice.total / 2).toFixed(2));
      return { ...invoice, payment_status: 'partial', amount_paid: partial };
    }

    return { ...invoice, payment_status: nextStatus };
  });
}

export function computeDashboard(state) {
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).toISOString().slice(0, 10);
  const next7Date = new Date(todayDate);
  next7Date.setDate(next7Date.getDate() + 7);
  const next7Days = next7Date.toISOString().slice(0, 10);

  const completedUnbilledVisits = state.visits.filter((visit) => visit.status === 'completed').length;
  const readyToBillVisits = state.visits.filter((visit) => visit.status === 'completed').length;
  const readyToBillAmount = state.visits
    .filter((visit) => visit.status === 'completed')
    .reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  const todayScheduledVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'scheduled'
  ).length;
  const todayCompletedVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'completed'
  ).length;
  const todaySkippedVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'skipped'
  ).length;
  const upcomingScheduledVisits = state.visits.filter(
    (visit) => visit.status === 'scheduled' && visit.visit_date >= today && visit.visit_date <= next7Days
  ).length;
  const paidThisMonth = (state.payments || [])
    .filter((payment) => payment.payment_date >= monthStart && payment.payment_date <= monthEnd)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const draftInvoices = state.invoices.filter((invoice) => invoice.payment_status === 'draft').length;
  const unpaidInvoices = state.invoices.filter((invoice) => ['sent', 'partial', 'overdue', 'draft'].includes(invoice.payment_status)).length;
  const overdueInvoices = state.invoices.filter((invoice) => invoice.payment_status === 'overdue' || (invoice.payment_status !== 'paid' && invoice.due_date < today)).length;
  const overdueAmount = state.invoices
    .filter((invoice) => invoice.payment_status === 'overdue' || (invoice.payment_status !== 'paid' && invoice.due_date < today))
    .reduce((sum, invoice) => sum + (invoice.total - (invoice.amount_paid || 0)), 0);
  const totalOutstanding = state.invoices
    .filter((invoice) => invoice.payment_status !== 'paid')
    .reduce((sum, invoice) => sum + (invoice.total - (invoice.amount_paid || 0)), 0);

  return {
    completedUnbilledVisits,
    readyToBillVisits,
    readyToBillAmount: Number(readyToBillAmount.toFixed(2)),
    todayScheduledVisits,
    todayCompletedVisits,
    todaySkippedVisits,
    upcomingScheduledVisits,
    paidThisMonth: Number(paidThisMonth.toFixed(2)),
    draftInvoices,
    unpaidInvoices,
    overdueInvoices,
    overdueAmount: Number(overdueAmount.toFixed(2)),
    totalOutstanding: Number(totalOutstanding.toFixed(2))
  };
}
