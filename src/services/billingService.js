import { emit } from '../data/appEventBus.js';
import { listCustomers } from '../data/repositories/customerRepository.js';
import { createInvoices, listInvoices } from '../data/repositories/invoiceRepository.js';
import { listProperties } from '../data/repositories/propertyRepository.js';
import { listVisits, updateVisit } from '../data/repositories/visitRepository.js';
import { readState } from '../data/storage/local-state-adapter.js';

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getCustomerMap(customers) {
  return Object.fromEntries((customers || []).map((customer) => [customer.customer_id, customer]));
}

function getPropertyMap(properties) {
  return Object.fromEntries((properties || []).map((property) => [property.property_id, property]));
}

export async function generateInvoicesForVisits(visitIds, metadata = {}) {
  const selectedVisitIds = new Set(visitIds);
  const state = readState();
  const properties = listProperties();
  const customers = listCustomers();
  const visits = listVisits();
  const existingInvoices = listInvoices();
  const propertyMap = getPropertyMap(properties);
  const customerMap = getCustomerMap(customers);
  const taxRate = state.settings.tax_rate ?? 0;

  const eligibleVisits = visits.filter((visit) => {
    if (!selectedVisitIds.has(visit.visit_id)) return false;
    if (visit.status !== 'completed') return false;
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

  Object.entries(grouped).forEach(([customerId, customerVisits], index) => {
    const subtotal = customerVisits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax).toFixed(2));
    const sequence = String(existingInvoices.length + index + 1).padStart(4, '0');
    const invoiceNumber = `${state.settings.invoice_prefix}-${new Date().getFullYear()}-${sequence}`;

    newInvoices.push({
      invoice_id: `inv_${crypto.randomUUID().slice(0, 8)}`,
      company_id: state.company.company_id,
      customer_id: customerId,
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: addDays(new Date(), state.settings.default_due_days).toISOString().slice(0, 10),
      visit_ids: customerVisits.map((visit) => visit.visit_id),
      line_items: customerVisits.map((visit) => ({
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

    customerVisits.forEach((visit) => touchedVisitIds.add(visit.visit_id));
  });

  const createdInvoices = await createInvoices(newInvoices, {
    ...metadata,
    action: metadata.action || 'billing:create-selected-invoices',
    eventAction: metadata.eventAction || 'billing-create-selected-invoices'
  });

  for (const visitId of touchedVisitIds) {
    await updateVisit(visitId, { status: 'billed' }, {
      ...metadata,
      action: 'billing:mark-visit-billed',
      eventAction: 'mark-billed'
    });
  }

  const summary = {
    createdCount: createdInvoices.length,
    billedVisitCount: touchedVisitIds.size,
    invoices: createdInvoices
  };

  if (createdInvoices.length || touchedVisitIds.size) {
    emit('billing:invoices-generated', {
      ...summary,
      visit_ids: [...touchedVisitIds],
      metadata
    });
  }

  return summary;
}

export async function generateInvoicesForDateRange(startDate, endDate, metadata = {}) {
  const properties = listProperties();
  const visits = listVisits();
  const propertyMap = getPropertyMap(properties);
  const visitIds = visits
    .filter((visit) => {
      if (visit.status !== 'completed') return false;
      if (visit.visit_date < startDate || visit.visit_date > endDate) return false;
      const property = propertyMap[visit.property_id];
      return Boolean(property?.customer_id);
    })
    .map((visit) => visit.visit_id);

  return generateInvoicesForVisits(visitIds, {
    ...metadata,
    action: metadata.action || 'billing:create-date-range-invoices',
    eventAction: metadata.eventAction || 'billing-create-date-range-invoices'
  });
}
