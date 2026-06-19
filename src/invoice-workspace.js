import { listCustomers } from './data/repositories/customerRepository.js';
import { listInvoices, listOpenInvoices } from './data/repositories/invoiceRepository.js';
import { listPayments } from './data/repositories/paymentRepository.js';
import { listProperties, listVisits } from './data/repositories/visitReadRepository.js';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

function getCustomerMap(customers) {
  return Object.fromEntries((customers || []).map((customer) => [customer.customer_id, customer]));
}

function getPropertyMap(properties) {
  return Object.fromEntries((properties || []).map((property) => [property.property_id, property]));
}

function paymentTotalsByInvoice(payments = []) {
  return payments.reduce((totals, payment) => {
    totals[payment.invoice_id] = Number((Number(totals[payment.invoice_id] || 0) + Number(payment.amount || 0)).toFixed(2));
    return totals;
  }, {});
}

function getPaidAmount(invoice, paymentTotals = {}) {
  return Number(paymentTotals[invoice.invoice_id] ?? invoice.amount_paid ?? 0);
}

function getBalance(invoice, paymentTotals = {}) {
  return Number((Number(invoice.total || 0) - getPaidAmount(invoice, paymentTotals)).toFixed(2));
}

function getStatusClass(invoice) {
  const status = invoice.payment_status || 'draft';
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'paid') return 'paid-up';
  if (status === 'overdue' || (invoice.due_date && invoice.due_date < today)) return 'overdue';
  return 'outstanding';
}

function invoiceActionText(invoice, paymentTotals = {}) {
  const balance = getBalance(invoice, paymentTotals);
  const status = invoice.payment_status || 'draft';
  if (status === 'paid') return 'Paid. Keep for records.';
  if (status === 'draft') return 'Draft. Review before sending.';
  if (status === 'partially_paid' || status === 'partial') return 'Partially paid. Follow up on remaining balance.';
  if (balance > 0) return 'Open balance. Follow up or record payment.';
  return 'Review invoice status.';
}

function getInvoiceVisits(invoice, visits) {
  const visitIds = Array.isArray(invoice.visit_ids) ? invoice.visit_ids : [];
  if (!visitIds.length) return [];
  const idSet = new Set(visitIds);
  return (visits || [])
    .filter((visit) => idSet.has(visit.visit_id))
    .sort((a, b) => String(a.visit_date || '').localeCompare(String(b.visit_date || '')));
}

function formatDateRange(visits, invoice) {
  const dates = visits.map((visit) => visit.visit_date).filter(Boolean).sort();
  if (!dates.length) return invoice.invoice_date || invoice.created_at?.slice(0, 10) || 'No service dates found';
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first} to ${last}`;
}

function groupVisitsByProperty(visits, propertyMap) {
  return visits.reduce((groups, visit) => {
    const property = propertyMap[visit.property_id];
    const key = visit.property_id || 'unknown-location';
    if (!groups[key]) {
      groups[key] = {
        address: property?.service_address || 'Unknown service location',
        serviceType: property?.service_type || 'Service',
        visits: [],
        total: 0
      };
    }
    groups[key].visits.push(visit);
    groups[key].total += Number(visit.price || 0);
    return groups;
  }, {});
}

function renderGroupedServiceLines(visits) {
  return visits.map((visit) => {
    const service = visit.service_description || 'Service visit';
    return `
      <li class="invoice-service-line">
        <span class="invoice-service-date">${visit.visit_date || 'No date'}</span>
        <strong>${service}</strong>
        <span class="invoice-service-price">${currency(visit.price)}</span>
      </li>
    `;
  }).join('');
}

function renderPropertyServiceGroup(group) {
  return `
    <article class="invoice-service-group">
      <div class="invoice-service-group-header">
        <div>
          <strong>${group.address}</strong>
          <p>${group.serviceType} · ${group.visits.length} visit${group.visits.length === 1 ? '' : 's'}</p>
        </div>
        <span>${currency(group.total)}</span>
      </div>
      <ul class="invoice-service-list">
        ${renderGroupedServiceLines(group.visits)}
      </ul>
    </article>
  `;
}

function renderServiceDetails(invoice, visits, propertyMap) {
  const groups = Object.values(groupVisitsByProperty(visits, propertyMap));
  return `
    <aside class="invoice-services-panel">
      <p class="eyebrow">Services invoiced</p>
      <h4>${formatDateRange(visits, invoice)}</h4>
      ${groups.length ? groups.map(renderPropertyServiceGroup).join('') : '<p>No linked visit details found for this invoice yet.</p>'}
    </aside>
  `;
}

function renderInvoiceListCard(invoice, customerMap, visits, selectedInvoiceId, paymentTotals = {}) {
  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice, paymentTotals);
  const invoiceVisits = getInvoiceVisits(invoice, visits);
  const isSelected = invoice.invoice_id === selectedInvoiceId;

  return `
    <button type="button" class="invoice-list-card ${isSelected ? 'active' : ''}" data-select-invoice="${invoice.invoice_id}">
      <div class="invoice-list-card-top">
        <div>
          <strong>${invoice.invoice_number}</strong>
          <span>${customerName}</span>
        </div>
        <span class="badge ${getStatusClass(invoice)}">${invoice.payment_status || 'draft'}</span>
      </div>
      <div class="invoice-list-meta">
        <span>Service: ${formatDateRange(invoiceVisits, invoice)}</span>
        <span>Due: ${invoice.due_date || 'n/a'}</span>
      </div>
      <div class="invoice-list-totals">
        <span>Total ${currency(invoice.total)}</span>
        <strong>Balance ${currency(balance)}</strong>
      </div>
    </button>
  `;
}

function renderInvoicePreview(invoice, customerMap, propertyMap, visits, paymentTotals = {}) {
  if (!invoice) {
    return `
      <aside class="panel invoice-preview-panel">
        <h3>Invoice Preview</h3>
        <p>Select an invoice to review its services, totals, due date, and follow-up actions.</p>
      </aside>
    `;
  }

  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice, paymentTotals);
  const paidAmount = getPaidAmount(invoice, paymentTotals);
  const status = invoice.payment_status || 'draft';
  const invoiceVisits = getInvoiceVisits(invoice, visits);

  return `
    <aside class="panel invoice-preview-panel" data-selected-invoice="${invoice.invoice_id}">
      <div class="invoice-preview-header">
        <div>
          <p class="eyebrow">Selected Invoice</p>
          <h3>${invoice.invoice_number}</h3>
          <p>${customerName}</p>
        </div>
        <span class="badge ${getStatusClass(invoice)}">${status}</span>
      </div>

      <div class="invoice-preview-total-card">
        <span>Balance Due</span>
        <strong>${currency(balance)}</strong>
        <p>${invoiceActionText(invoice, paymentTotals)}</p>
      </div>

      <div class="invoice-card-grid invoice-preview-grid">
        <div><span>Total</span><strong>${currency(invoice.total)}</strong></div>
        <div><span>Paid</span><strong>${currency(paidAmount)}</strong></div>
        <div><span>Invoice Date</span><strong>${invoice.invoice_date || invoice.created_at?.slice(0, 10) || 'n/a'}</strong></div>
        <div><span>Due</span><strong>${invoice.due_date || 'n/a'}</strong></div>
      </div>

      ${renderServiceDetails(invoice, invoiceVisits, propertyMap)}

      <div class="actions invoice-actions invoice-preview-actions">
        <button type="button" data-invoice-payment>Record payment</button>
        <button type="button" data-invoice-print>Print / Save PDF</button>
      </div>
      <p class="invoice-next-action"><strong>V1 note:</strong> sending is not connected yet. Print or save as PDF for now.</p>
    </aside>
  `;
}

function getSelectedInvoiceId(invoices) {
  const existing = document.querySelector('[data-selected-invoice]')?.dataset.selectedInvoice;
  if (existing && invoices.some((invoice) => invoice.invoice_id === existing)) return existing;
  const firstOpen = invoices.find((invoice) => (invoice.payment_status || '') !== 'paid');
  return firstOpen?.invoice_id || invoices[0]?.invoice_id || '';
}

function enhanceInvoicesView() {
  const section = Array.from(document.querySelectorAll('main.content section')).find((candidate) =>
    candidate.querySelector('h2')?.textContent?.trim() === 'Invoices'
  );
  if (!section || section.dataset.invoiceWorkspace === 'true') return;

  const customers = listCustomers();
  const properties = listProperties();
  const visits = listVisits();
  const paymentTotals = paymentTotalsByInvoice(listPayments());
  const customerMap = getCustomerMap(customers);
  const propertyMap = getPropertyMap(properties);
  const invoices = listInvoices().sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')));
  const openInvoices = listOpenInvoices();
  const overdueInvoices = openInvoices.filter((invoice) => getStatusClass(invoice) === 'overdue');
  const openBalance = openInvoices.reduce((sum, invoice) => sum + Math.max(0, getBalance(invoice, paymentTotals)), 0);
  const selectedInvoiceId = getSelectedInvoiceId(invoices);
  const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);

  section.dataset.invoiceWorkspace = 'true';
  section.classList.add('invoice-workspace');
  section.innerHTML = `
    <div class="page-header-v1">
      <div>
        <h2>Invoices</h2>
        <p>Review invoice status, balances, due dates, services invoiced, and payment follow-up actions.</p>
      </div>
    </div>
    <div class="invoice-summary-grid">
      <article class="route-stat"><span>Total invoices</span><strong>${invoices.length}</strong></article>
      <article class="route-stat"><span>Open invoices</span><strong>${openInvoices.length}</strong></article>
      <article class="route-stat"><span>Overdue</span><strong>${overdueInvoices.length}</strong></article>
      <article class="route-stat"><span>Open balance</span><strong>${currency(openBalance)}</strong></article>
    </div>
    <div class="invoice-workspace-layout">
      <div class="panel invoice-list-panel">
        <div class="invoice-list-header">
          <div>
            <p class="eyebrow">Invoice list</p>
            <h3>Billing Queue</h3>
          </div>
          <span>${openInvoices.length} open</span>
        </div>
        <div class="invoice-list-stack">
          ${invoices.length ? invoices.map((invoice) => renderInvoiceListCard(invoice, customerMap, visits, selectedInvoiceId, paymentTotals)).join('') : '<p>No invoices found yet.</p>'}
        </div>
      </div>
      ${renderInvoicePreview(selectedInvoice, customerMap, propertyMap, visits, paymentTotals)}
    </div>
  `;

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals);
}

function rerenderInvoiceWorkspace(section, selectedInvoiceId, invoices, customerMap, propertyMap, visits, paymentTotals) {
  const list = section.querySelector('.invoice-list-stack');
  const preview = section.querySelector('.invoice-preview-panel');
  const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);

  if (list) {
    list.innerHTML = invoices.map((invoice) => renderInvoiceListCard(invoice, customerMap, visits, selectedInvoiceId, paymentTotals)).join('');
  }

  if (preview) {
    preview.outerHTML = renderInvoicePreview(selectedInvoice, customerMap, propertyMap, visits, paymentTotals);
  }

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals);
}

function bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals) {
  section.querySelectorAll('[data-select-invoice]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      rerenderInvoiceWorkspace(section, button.dataset.selectInvoice, invoices, customerMap, propertyMap, visits, paymentTotals);
    });
  });

  section.querySelectorAll('[data-invoice-payment]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => document.querySelector('[data-nav="payments"]')?.click());
  });

  section.querySelectorAll('[data-invoice-print]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => window.print());
  });
}

let scheduled = false;
function scheduleEnhanceInvoicesView() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceInvoicesView();
  });
}

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleEnhanceInvoicesView);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleEnhanceInvoicesView();
