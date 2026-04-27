import {
  computeDashboard,
  generateBatchInvoices,
  getCustomerMap,
  getPropertyMap,
  loadState,
  resetSeed,
  saveState,
  updateInvoicePaymentStatus
} from './lib/store.js';

const app = document.querySelector('#app');
let state = loadState();
let activeView = 'dashboard';
let flashMessage = '';

const navItems = [
  ['dashboard', 'Dashboard'],
  ['customers', 'Customers'],
  ['properties', 'Properties'],
  ['visits', 'Service Visits'],
  ['batch', 'Batch Invoices'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['settings', 'Settings']
];

function currency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function render() {
  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const metrics = computeDashboard(state);

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <h1>ServiceBatch Invoice</h1>
        <nav>${navItems
          .map(
            ([id, label]) =>
              `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${id}">${label}</button>`
          )
          .join('')}</nav>
      </aside>
      <main class="content">
        ${flashMessage ? `<div class="flash">${flashMessage}</div>` : ''}
        ${renderView(activeView, metrics, customerMap, propertyMap)}
      </main>
      <nav class="bottom-nav">
        ${navItems
          .slice(0, 5)
          .map(
            ([id, label]) =>
              `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${id}">${label}</button>`
          )
          .join('')}
      </nav>
    </div>
  `;

  bindEvents();
}

function renderView(view, metrics, customerMap, propertyMap) {
  if (view === 'dashboard') {
    return `
      <section>
        <h2>Operations Dashboard</h2>
        <div class="cards">
          ${metricCard('Completed Unbilled Visits', metrics.completedUnbilledVisits)}
          ${metricCard('Draft Invoices', metrics.draftInvoices)}
          ${metricCard('Unpaid Invoices', metrics.unpaidInvoices)}
          ${metricCard('Overdue Invoices', metrics.overdueInvoices)}
          ${metricCard('Total Outstanding', currency(metrics.totalOutstanding))}
        </div>
        <button class="primary" data-nav="batch">Generate Batch Invoices</button>
      </section>
    `;
  }

  if (view === 'customers') {
    return `<section><h2>Customers</h2><div class="stack">${state.customers
      .map(
        (c) => `<article class="panel"><h3>${c.name}</h3><p>${c.phone} · ${c.email}</p><p>${c.billing_address}</p><p>Status: ${c.status}</p></article>`
      )
      .join('')}</div></section>`;
  }

  if (view === 'properties') {
    return `<section><h2>Properties / Service Locations</h2><div class="stack">${state.properties
      .map((p) => {
        const customer = customerMap[p.customer_id];
        return `<article class="panel"><h3>${p.service_address}</h3><p>${customer?.name ?? 'Unknown Customer'}</p><p>${p.service_type} · ${p.recurring_frequency}</p><p>Default Price: ${currency(p.default_price)}</p></article>`;
      })
      .join('')}</div></section>`;
  }

  if (view === 'visits') {
    return `<section><h2>Service Visits</h2><div class="stack">${state.visits
      .map((v) => {
        const property = propertyMap[v.property_id];
        return `<article class="panel"><h3>${v.visit_date} · ${v.service_description}</h3><p>${property?.service_address ?? 'Unknown property'}</p><p>Price ${currency(v.price)} · Status: ${v.status}</p></article>`;
      })
      .join('')}</div></section>`;
  }

  if (view === 'batch') {
    return `
      <section>
        <h2>Batch Invoice Generator</h2>
        <p>Select a date range to invoice completed, unbilled visits and group by customer.</p>
        <form id="batch-form" class="panel">
          <label>Start Date<input type="date" name="start" value="2026-04-01" required/></label>
          <label>End Date<input type="date" name="end" value="2026-04-30" required/></label>
          <button class="primary" type="submit">Generate Batch Invoices</button>
        </form>
      </section>
    `;
  }

  if (view === 'invoices') {
    return `<section><h2>Invoices</h2><div class="stack">${state.invoices
      .map((i) => `<article class="panel"><h3>${i.invoice_number}</h3><p>${customerMap[i.customer_id]?.name ?? i.customer_name}</p><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p><p>Status: ${i.payment_status} · Due ${i.due_date}</p></article>`)
      .join('')}</div></section>`;
  }

  if (view === 'payments') {
    const invoices = state.invoices.filter((i) => i.payment_status !== 'paid');
    const overdue = invoices.filter((i) => i.payment_status === 'overdue');
    return `
      <section>
        <h2>Payments / Outstanding Tracking</h2>
        <p>Outstanding Balance: <strong>${currency(computeDashboard(state).totalOutstanding)}</strong></p>
        <h3>Unpaid Invoices</h3>
        <div class="stack">
          ${invoices
            .map(
              (i) => `<article class="panel"><h4>${i.invoice_number} · ${customerMap[i.customer_id]?.name ?? i.customer_name}</h4><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p><div class="actions"><button data-pay="${i.invoice_id}:partial">Mark Partial</button><button data-pay="${i.invoice_id}:paid">Mark Paid</button></div></article>`
            )
            .join('')}
        </div>
        <h3>Overdue Invoices</h3>
        <ul>${overdue.map((i) => `<li>${i.invoice_number} - ${currency(i.total - (i.amount_paid || 0))}</li>`).join('')}</ul>
      </section>
    `;
  }

  return `
    <section>
      <h2>Settings</h2>
      <article class="panel">
        <p>Company: ${state.company.name}</p>
        <p>Company ID: ${state.company.company_id}</p>
        <p>Invoice Prefix: ${state.settings.invoice_prefix}</p>
        <p>Tax Rate: ${(state.settings.tax_rate * 100).toFixed(1)}%</p>
        <button id="reset-seed">Reset Demo Data</button>
      </article>
    </section>
  `;
}

function metricCard(label, value) {
  return `<article class="card"><p>${label}</p><strong>${value}</strong></article>`;
}

function bindEvents() {
  app.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      activeView = button.dataset.nav;
      flashMessage = '';
      render();
    });
  });

  const batchForm = app.querySelector('#batch-form');
  if (batchForm) {
    batchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(batchForm);
      const start = formData.get('start');
      const end = formData.get('end');
      const summary = generateBatchInvoices(state, start, end);
      saveState(state);
      flashMessage = `Generated ${summary.createdCount} invoices from ${summary.billedVisitCount} completed visits.`;
      activeView = 'invoices';
      render();
    });
  }

  app.querySelectorAll('[data-pay]').forEach((button) => {
    button.addEventListener('click', () => {
      const [invoiceId, status] = button.dataset.pay.split(':');
      updateInvoicePaymentStatus(state, invoiceId, status);
      saveState(state);
      flashMessage = `Invoice ${invoiceId} marked as ${status}.`;
      render();
    });
  });

  const resetButton = app.querySelector('#reset-seed');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      state = resetSeed();
      flashMessage = 'Seed data restored.';
      render();
    });
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

render();
