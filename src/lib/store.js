import { seedData } from '../data/seed.js';
import {
  getCustomerMap,
  getDashboardMetrics,
  getPropertyMap
} from '../data/selectors/dashboardSelectors.js';
import { generateInvoicesForVisits } from '../services/billingService.js';
import { updateInvoicePaymentStatus as updateInvoicePaymentStatusService } from '../services/paymentService.js';

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

export { getCustomerMap, getPropertyMap };

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
      visit_ids: visits.map((visit) => visit.visit_id),
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

export function generateSelectedVisitInvoices(state, visitIds) {
  const summary = generateInvoicesForVisits(visitIds, {
    source: 'store-compat'
  });
  const nextState = loadState();
  state.visits = nextState.visits;
  state.invoices = nextState.invoices;
  return summary;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function updateInvoicePaymentStatus(state, invoiceId, nextStatus) {
  const updatedInvoice = updateInvoicePaymentStatusService(invoiceId, nextStatus, {
    source: 'store-compat'
  });

  if (!updatedInvoice) return;

  state.invoices = state.invoices.map((invoice) =>
    invoice.invoice_id === invoiceId ? updatedInvoice : invoice
  );
}

export function computeDashboard(state) {
  return getDashboardMetrics(state);
}
