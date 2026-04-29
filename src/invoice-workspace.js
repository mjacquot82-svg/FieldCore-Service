const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function getCustomerMap(state) {
  return Object.fromEntries((state.customers || []).map((customer) => [customer.customer_id, customer]));
}

function getPropertyMap(state) {
  return Object.fromEntries((state.properties || []).map((property) => [property.property_id, property]));
}

function getBalance(invoice) {
  return Number((Number(invoice.total || 0) - Number(invoice.amount_paid || 0)).toFixed(2));
}

function getStatusClass(invoice) {
  const status = invoice.payment_status || 'draft';
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'paid') return 'paid-up';
  if (status === 'overdue' || (invoice.due_date && invoice.due_date < today)) return 'overdue';
  return 'outstanding';
}

function invoiceActionText(invoice) {
  const balance = getBalance(invoice);
  const status = invoice.payment_status || 'draft';
  if (status === 'paid') return 'Paid. Keep for records.';
  if (status === 'draft') return 'Draft. Review before sending.';
  if (balance > 0) return 'Open balance. Follow up or record payment.';
  return 'Review invoice status.';
}

function getInvoiceVisits(invoice, state) {
  const visitIds = Array.isArray(invoice.visit_ids) ? invoice.visit_ids : [];
  if (!visitIds.length) return [];
  const idSet = new Set(visitIds);
  return (state.visits || [])
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

function renderServiceLine(visit, propertyMap) {
  const property = propertyMap[visit.property_id];
  const service = visit.service_description || property?.service_type || 'Service';
  const address = property?.service_address || 'Unknown service location';
  return `
    <li class="invoice-service-line">
      <span class="invoice-service-date">${visit.visit_date || 'No date'}</span>
      <div>
        <strong>${service}</strong>
        <p>${address}</p>
      </div>
      <span class="invoice-service-price">${currency(visit.price)}</span>
    </li>
  `;
}

function renderServiceDetails(invoice, visits, propertyMap) {
  return `
    <aside class="invoice-services-panel">
      <p class="eyebrow">Services invoiced</p>
      <h4>${formatDateRange(visits, invoice)}</h4>
      ${visits.length ? `
        <ul class="invoice-service-list">
          ${visits.map((visit) => renderServiceLine(visit, propertyMap)).join('')}
        </ul>
      ` : '<p>No linked visit details found for this invoice yet.</p>'}
    </aside>
  `;
}

function renderInvoiceCard(invoice, customerMap, propertyMap, state) {
  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice);
  const status = invoice.payment_status || 'draft';
  const visits = getInvoiceVisits(invoice, state);
  return `
    <article class="panel invoice-card-v1 invoice-card-with-details" data-invoice-card="${invoice.invoice_id}">
      <div class="invoice-summary-panel">
        <div class="invoice-card-header">
          <div>
            <p class="eyebrow">Invoice</p>
            <h3>${invoice.invoice_number}</h3>
            <p>${customerName}</p>
          </div>
          <span class="badge ${getStatusClass(invoice)}">${status}</span>
        </div>
        <div class="invoice-card-grid">
          <div><span>Total</span><strong>${currency(invoice.total)}</strong></div>
          <div><span>Paid</span><strong>${currency(invoice.amount_paid || 0)}</strong></div>
          <div><span>Balance</span><strong>${currency(balance)}</strong></div>
          <div><span>Due</span><strong>${invoice.due_date || 'n/a'}</strong></div>
        </div>
        <p class="invoice-next-action">${invoiceActionText(invoice)}</p>
        <div class="invoice-details" hidden>
          <p><strong>Invoice date:</strong> ${invoice.invoice_date || invoice.created_at?.slice(0, 10) || 'n/a'}</p>
          <p><strong>Customer:</strong> ${customerName}</p>
          <p><strong>Status:</strong> ${status}</p>
          <p><strong>V1 note:</strong> sending is not connected yet. Print or save as PDF for now.</p>
        </div>
        <div class="actions invoice-actions">
          <button type="button" data-invoice-toggle>View details</button>
          <button type="button" data-invoice-payment>Record payment</button>
          <button type="button" data-invoice-print>Print / Save PDF</button>
        </div>
      </div>
      ${renderServiceDetails(invoice, visits, propertyMap)}
    </article>
  `;
}

function enhanceInvoicesView() {
  const section = Array.from(document.querySelectorAll('main.content section')).find((candidate) =>
    candidate.querySelector('h2')?.textContent?.trim() === 'Invoices'
  );
  if (!section || section.dataset.invoiceWorkspace === 'true') return;

  const state = loadState();
  if (!state) return;

  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const invoices = [...(state.invoices || [])].sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')));
  const openInvoices = invoices.filter((invoice) => (invoice.payment_status || '') !== 'paid');
  const overdueInvoices = openInvoices.filter((invoice) => getStatusClass(invoice) === 'overdue');
  const openBalance = openInvoices.reduce((sum, invoice) => sum + Math.max(0, getBalance(invoice)), 0);

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
    <div class="stack invoice-card-stack">
      ${invoices.length ? invoices.map((invoice) => renderInvoiceCard(invoice, customerMap, propertyMap, state)).join('') : '<article class="panel"><p>No invoices found yet.</p></article>'}
    </div>
  `;

  bindInvoiceWorkspace(section);
}

function bindInvoiceWorkspace(section) {
  section.querySelectorAll('[data-invoice-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-invoice-card]');
      const details = card?.querySelector('.invoice-details');
      if (!details) return;
      details.hidden = !details.hidden;
      button.textContent = details.hidden ? 'View details' : 'Hide details';
    });
  });

  section.querySelectorAll('[data-invoice-payment]').forEach((button) => {
    button.addEventListener('click', () => document.querySelector('[data-nav="payments"]')?.click());
  });

  section.querySelectorAll('[data-invoice-print]').forEach((button) => {
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
