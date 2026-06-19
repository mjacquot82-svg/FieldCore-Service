import { listCustomers } from './data/repositories/customerRepository.js';
import {
  listInvoices,
  listOpenInvoices,
  markInvoiceSent,
  recordInvoiceExport
} from './data/repositories/invoiceRepository.js';
import { listPayments } from './data/repositories/paymentRepository.js';
import { listProperties, listVisits } from './data/repositories/visitReadRepository.js';
import { getSession } from './role-pin-login.js';
import { getUiPermissions } from './services/uiPermissionService.js';
import { escapeAttr, escapeHtml } from './utils/renderSecurity.js';

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
        <span class="invoice-service-date">${escapeHtml(visit.visit_date || 'No date')}</span>
        <strong>${escapeHtml(service)}</strong>
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
          <strong>${escapeHtml(group.address)}</strong>
          <p>${escapeHtml(group.serviceType)} · ${group.visits.length} visit${group.visits.length === 1 ? '' : 's'}</p>
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

function renderPrintableInvoice(invoice, customerMap, propertyMap, visits, paymentTotals = {}) {
  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const invoiceVisits = getInvoiceVisits(invoice, visits);
  const balance = getBalance(invoice, paymentTotals);
  const paidAmount = getPaidAmount(invoice, paymentTotals);
  const groups = Object.values(groupVisitsByProperty(invoiceVisits, propertyMap));

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(invoice.invoice_number || 'Invoice')}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 40px; }
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; }
          h1, h2, h3 { margin: 0 0 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { border-bottom: 1px solid #d1d5db; padding: 10px; text-align: left; }
          th:last-child, td:last-child { text-align: right; }
          .totals { margin-top: 24px; margin-left: auto; width: 280px; }
          .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
          .balance { font-size: 1.2rem; font-weight: 700; border-top: 2px solid #111827; }
          @media print { button { display: none; } body { margin: 24px; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Print / Save PDF</button>
        <header>
          <div>
            <h1>Invoice</h1>
            <p>${escapeHtml(invoice.invoice_number || 'Invoice')}</p>
          </div>
          <div>
            <h2>${escapeHtml(customerName)}</h2>
            <p>Invoice date: ${escapeHtml(invoice.invoice_date || 'n/a')}</p>
            <p>Due: ${escapeHtml(invoice.due_date || 'n/a')}</p>
            <p>Status: ${escapeHtml(invoice.payment_status || 'draft')}</p>
          </div>
        </header>
        <table>
          <thead><tr><th>Date</th><th>Service</th><th>Location</th><th>Amount</th></tr></thead>
          <tbody>
            ${groups.flatMap((group) => group.visits.map((visit) => `
              <tr>
                <td>${escapeHtml(visit.visit_date || 'No date')}</td>
                <td>${escapeHtml(visit.service_description || group.serviceType || 'Service')}</td>
                <td>${escapeHtml(group.address)}</td>
                <td>${currency(visit.price)}</td>
              </tr>
            `)).join('') || `<tr><td colspan="4">No linked service lines found.</td></tr>`}
          </tbody>
        </table>
        <section class="totals">
          <div><span>Subtotal</span><strong>${currency(invoice.subtotal)}</strong></div>
          <div><span>Tax</span><strong>${currency(invoice.tax)}</strong></div>
          <div><span>Total</span><strong>${currency(invoice.total)}</strong></div>
          <div><span>Paid</span><strong>${currency(paidAmount)}</strong></div>
          <div class="balance"><span>Balance Due</span><strong>${currency(balance)}</strong></div>
        </section>
      </body>
    </html>
  `;
}

function renderInvoiceListCard(invoice, customerMap, visits, selectedInvoiceId, paymentTotals = {}) {
  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice, paymentTotals);
  const invoiceVisits = getInvoiceVisits(invoice, visits);
  const isSelected = invoice.invoice_id === selectedInvoiceId;

  return `
    <button type="button" class="invoice-list-card ${isSelected ? 'active' : ''}" data-select-invoice="${escapeAttr(invoice.invoice_id)}">
      <div class="invoice-list-card-top">
        <div>
          <strong>${escapeHtml(invoice.invoice_number)}</strong>
          <span>${escapeHtml(customerName)}</span>
        </div>
        <span class="badge ${getStatusClass(invoice)}">${escapeHtml(invoice.payment_status || 'draft')}</span>
      </div>
      <div class="invoice-list-meta">
        <span>Service: ${escapeHtml(formatDateRange(invoiceVisits, invoice))}</span>
        <span>Due: ${escapeHtml(invoice.due_date || 'n/a')}</span>
      </div>
      <div class="invoice-list-totals">
        <span>Total ${currency(invoice.total)}</span>
        <strong>Balance ${currency(balance)}</strong>
      </div>
    </button>
  `;
}

function renderInvoicePreview(invoice, customerMap, propertyMap, visits, paymentTotals = {}, permissions = {}) {
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
    <aside class="panel invoice-preview-panel" data-selected-invoice="${escapeAttr(invoice.invoice_id)}">
      <div class="invoice-preview-header">
        <div>
          <p class="eyebrow">Selected Invoice</p>
          <h3>${escapeHtml(invoice.invoice_number)}</h3>
          <p>${escapeHtml(customerName)}</p>
        </div>
        <span class="badge ${getStatusClass(invoice)}">${escapeHtml(status)}</span>
      </div>

      <div class="invoice-preview-total-card">
        <span>Balance Due</span>
        <strong>${currency(balance)}</strong>
        <p>${escapeHtml(invoiceActionText(invoice, paymentTotals))}</p>
      </div>

      <div class="invoice-card-grid invoice-preview-grid">
        <div><span>Total</span><strong>${currency(invoice.total)}</strong></div>
        <div><span>Paid</span><strong>${currency(paidAmount)}</strong></div>
        <div><span>Invoice Date</span><strong>${escapeHtml(invoice.invoice_date || invoice.created_at?.slice(0, 10) || 'n/a')}</strong></div>
        <div><span>Due</span><strong>${escapeHtml(invoice.due_date || 'n/a')}</strong></div>
        <div><span>Sent</span><strong>${escapeHtml(invoice.sent_at ? invoice.sent_at.slice(0, 10) : 'not sent')}</strong></div>
        <div><span>Delivery</span><strong>${escapeHtml(invoice.delivery_status || 'not_sent')}</strong></div>
      </div>

      ${renderServiceDetails(invoice, invoiceVisits, propertyMap)}

      <div class="actions invoice-actions invoice-preview-actions">
        ${permissions?.financials?.recordPayments ? '<button type="button" data-invoice-payment>Record payment</button>' : ''}
        ${permissions?.financials?.exportInvoices ? '<button type="button" data-invoice-export>Export / Print</button>' : ''}
        ${permissions?.financials?.exportInvoices ? '<button type="button" data-invoice-mark-sent>Mark Sent</button>' : ''}
      </div>
      <p class="invoice-next-action"><strong>Manual delivery:</strong> export the invoice, send it outside FieldCore, then mark it sent.</p>
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
  const permissions = getUiPermissions(getSession());
  if (!permissions.financials.read) return;
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
      ${renderInvoicePreview(selectedInvoice, customerMap, propertyMap, visits, paymentTotals, permissions)}
    </div>
  `;

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals, permissions);
}

function rerenderInvoiceWorkspace(section, selectedInvoiceId, invoices, customerMap, propertyMap, visits, paymentTotals, permissions) {
  const list = section.querySelector('.invoice-list-stack');
  const preview = section.querySelector('.invoice-preview-panel');
  const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);

  if (list) {
    list.innerHTML = invoices.map((invoice) => renderInvoiceListCard(invoice, customerMap, visits, selectedInvoiceId, paymentTotals)).join('');
  }

  if (preview) {
    preview.outerHTML = renderInvoicePreview(selectedInvoice, customerMap, propertyMap, visits, paymentTotals, permissions);
  }

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals, permissions);
}

function bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, visits, paymentTotals, permissions) {
  section.querySelectorAll('[data-select-invoice]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      rerenderInvoiceWorkspace(section, button.dataset.selectInvoice, invoices, customerMap, propertyMap, visits, paymentTotals, permissions);
    });
  });

  section.querySelectorAll('[data-invoice-payment]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      if (!permissions?.financials?.recordPayments) return;
      document.querySelector('[data-nav="payments"]')?.click();
    });
  });

  section.querySelectorAll('[data-invoice-export]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      if (!permissions?.financials?.exportInvoices) return;
      const selectedInvoiceId = section.querySelector('[data-selected-invoice]')?.dataset.selectedInvoice;
      const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);
      if (!selectedInvoice) return;
      await recordInvoiceExport(selectedInvoice.invoice_id, { format: 'print', source: 'invoice-workspace' });
      section.dataset.invoiceWorkspace = 'false';
      const popup = window.open('', '_blank');
      if (!popup) {
        window.print();
        scheduleEnhanceInvoicesView();
        return;
      }
      popup.document.write(renderPrintableInvoice(selectedInvoice, customerMap, propertyMap, visits, paymentTotals));
      popup.document.close();
      popup.focus();
      popup.print();
      scheduleEnhanceInvoicesView();
    });
  });

  section.querySelectorAll('[data-invoice-mark-sent]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      if (!permissions?.financials?.exportInvoices) return;
      const selectedInvoiceId = section.querySelector('[data-selected-invoice]')?.dataset.selectedInvoice;
      const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);
      if (!selectedInvoice) return;
      const customer = customerMap[selectedInvoice.customer_id];
      const defaultRecipient = selectedInvoice.sent_to || customer?.email || '';
      const sentTo = window.prompt('Sent to email or contact:', defaultRecipient);
      if (sentTo === null) return;
      await markInvoiceSent(selectedInvoice.invoice_id, sentTo, {
        source: 'invoice-workspace',
        deliveryStatus: 'sent'
      });
      section.dataset.invoiceWorkspace = 'false';
      scheduleEnhanceInvoicesView();
    });
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
