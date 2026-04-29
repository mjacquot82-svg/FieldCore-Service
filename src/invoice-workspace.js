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

function renderInvoiceListCard(invoice, customerMap, state, selectedInvoiceId) {
  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice);
  const visits = getInvoiceVisits(invoice, state);
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
        <span>Service: ${formatDateRange(visits, invoice)}</span>
        <span>Due: ${invoice.due_date || 'n/a'}</span>
      </div>
      <div class="invoice-list-totals">
        <span>Total ${currency(invoice.total)}</span>
        <strong>Balance ${currency(balance)}</strong>
      </div>
    </button>
  `;
}

function renderInvoicePreview(invoice, customerMap, propertyMap, state) {
  if (!invoice) {
    return `
      <aside class="panel invoice-preview-panel">
        <h3>Invoice Preview</h3>
        <p>Select an invoice to review its services, totals, due date, and follow-up actions.</p>
      </aside>
    `;
  }

  const customerName = customerMap[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const balance = getBalance(invoice);
  const status = invoice.payment_status || 'draft';
  const visits = getInvoiceVisits(invoice, state);

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
        <p>${invoiceActionText(invoice)}</p>
      </div>

      <div class="invoice-card-grid invoice-preview-grid">
        <div><span>Total</span><strong>${currency(invoice.total)}</strong></div>
        <div><span>Paid</span><strong>${currency(invoice.amount_paid || 0)}</strong></div>
        <div><span>Invoice Date</span><strong>${invoice.invoice_date || invoice.created_at?.slice(0, 10) || 'n/a'}</strong></div>
        <div><span>Due</span><strong>${invoice.due_date || 'n/a'}</strong></div>
      </div>

      ${renderServiceDetails(invoice, visits, propertyMap)}

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

  const state = loadState();
  if (!state) return;

  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const invoices = [...(state.invoices || [])].sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')));
  const openInvoices = invoices.filter((invoice) => (invoice.payment_status || '') !== 'paid');
  const overdueInvoices = openInvoices.filter((invoice) => getStatusClass(invoice) === 'overdue');
  const openBalance = openInvoices.reduce((sum, invoice) => sum + Math.max(0, getBalance(invoice)), 0);
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
          ${invoices.length ? invoices.map((invoice) => renderInvoiceListCard(invoice, customerMap, state, selectedInvoiceId)).join('') : '<p>No invoices found yet.</p>'}
        </div>
      </div>
      ${renderInvoicePreview(selectedInvoice, customerMap, propertyMap, state)}
    </div>
  `;

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, state);
}

function rerenderInvoiceWorkspace(section, selectedInvoiceId, invoices, customerMap, propertyMap, state) {
  const list = section.querySelector('.invoice-list-stack');
  const preview = section.querySelector('.invoice-preview-panel');
  const selectedInvoice = invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId);

  if (list) {
    list.innerHTML = invoices.map((invoice) => renderInvoiceListCard(invoice, customerMap, state, selectedInvoiceId)).join('');
  }

  if (preview) {
    preview.outerHTML = renderInvoicePreview(selectedInvoice, customerMap, propertyMap, state);
  }

  bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, state);
}

function bindInvoiceWorkspace(section, invoices, customerMap, propertyMap, state) {
  section.querySelectorAll('[data-select-invoice]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      rerenderInvoiceWorkspace(section, button.dataset.selectInvoice, invoices, customerMap, propertyMap, state);
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
