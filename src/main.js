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
let selectedRouteDate = new Date().toISOString().slice(0, 10);

const navItems = [
  ['dashboard', 'Dashboard'],
  ['today-route', 'Today’s Route'],
  ['customers', 'Customers'],
  ['properties', 'Properties'],
  ['visits', 'Service Visits'],
  ['batch', 'Ready to Bill'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['settings', 'Settings']
];

function currency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function getCustomerBalance(customerId) {
  const today = new Date().toISOString().slice(0, 10);
  return state.invoices.reduce(
    (totals, invoice) => {
      if (invoice.customer_id !== customerId) return totals;
      if (invoice.payment_status === 'paid') return totals;
      const remaining = Number((invoice.total - (invoice.amount_paid || 0)).toFixed(2));
      if (remaining <= 0) return totals;

      totals.outstanding += remaining;
      if (invoice.payment_status === 'overdue' || invoice.due_date < today) {
        totals.overdue += remaining;
      }
      return totals;
    },
    { outstanding: 0, overdue: 0 }
  );
}

function ensureRouteVisitsForDate(targetDate) {
  const customerMap = getCustomerMap(state);
  const recurringFrequencies = new Set(['weekly', 'biweekly', 'monthly']);
  const newVisits = [];

  state.properties.forEach((property) => {
    const customer = customerMap[property.customer_id];
    if (property.company_id !== state.company.company_id) return;
    if (property.status !== 'active') return;
    if (!recurringFrequencies.has(property.recurring_frequency)) return;
    if (!customer || customer.status !== 'active') return;

    const hasVisitForDate = state.visits.some(
      (visit) => visit.property_id === property.property_id && visit.visit_date === targetDate
    );
    if (hasVisitForDate) return;

    newVisits.push({
      visit_id: `visit_${crypto.randomUUID().slice(0, 8)}`,
      company_id: state.company.company_id,
      property_id: property.property_id,
      visit_date: targetDate,
      service_description: `${property.recurring_frequency} ${property.service_type.toLowerCase()} service`,
      price: property.default_price,
      status: 'scheduled',
      notes: property.notes || 'Auto-generated recurring visit.',
      created_at: new Date().toISOString()
    });
  });

  if (newVisits.length) {
    state.visits = [...state.visits, ...newVisits];
  }

  return newVisits.length;
}

function render() {
  if (activeView === 'today-route') {
    const createdCount = ensureRouteVisitsForDate(selectedRouteDate);
    if (createdCount > 0) {
      saveState(state);
    }
  }

  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const metrics = computeDashboard(state);
  const companyName = state.company?.name?.trim() || 'ServiceBatch';

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <h1>${companyName}</h1>
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
          .slice(0, 6)
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
          ${metricCard('Today Scheduled Visits', metrics.todayScheduledVisits)}
          ${metricCard('Today Completed Visits', metrics.todayCompletedVisits)}
          ${metricCard('Today Skipped Visits', metrics.todaySkippedVisits)}
          ${metricCard('Ready-to-Bill Visits', metrics.readyToBillVisits)}
          ${metricCard('Ready-to-Bill Amount', currency(metrics.readyToBillAmount))}
          ${metricCard('Upcoming Scheduled (Next 7 Days)', metrics.upcomingScheduledVisits)}
          ${metricCard('Paid This Month', currency(metrics.paidThisMonth))}
          ${metricCard('Completed Unbilled Visits', metrics.completedUnbilledVisits)}
          ${metricCard('Draft Invoices', metrics.draftInvoices)}
          ${metricCard('Unpaid Invoices', metrics.unpaidInvoices)}
          ${metricCard('Overdue Invoices', metrics.overdueInvoices)}
          ${metricCard('Total Outstanding', currency(metrics.totalOutstanding))}
        </div>
        <button class="primary" data-nav="batch">Open Ready to Bill</button>
      </section>
    `;
  }

  if (view === 'customers') {
    return `<section><h2>Customers</h2><div class="stack">${state.customers
      .map((c) => {
        const balance = getCustomerBalance(c.customer_id);
        const paidUp = balance.outstanding <= 0;
        const overdue = balance.overdue > 0;
        return `<article class="panel"><h3>${c.name}</h3><p>${c.phone} · ${c.email}</p><p>${c.billing_address}</p><p>Status: ${c.status}</p><div class="balance-badges">${paidUp ? '<span class="badge paid-up">Paid up</span>' : `<span class="badge outstanding">Outstanding: ${currency(balance.outstanding)}</span>`}${overdue ? `<span class="badge overdue">Overdue: ${currency(balance.overdue)}</span>` : ''}</div><div class="actions"><button data-ledger="${c.customer_id}">View Ledger</button></div></article>`;
      })
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

  if (view === 'today-route') {
    const routeVisits = state.visits.filter((visit) => visit.visit_date === selectedRouteDate);
    return `
      <section>
        <h2>Today’s Route / Daily Work List</h2>
        <div class="panel">
          <label>Select Date<input type="date" id="route-date" value="${selectedRouteDate}" /></label>
        </div>
        <div class="stack">
          ${
            routeVisits.length
              ? routeVisits
                  .map((visit) => {
                    const property = propertyMap[visit.property_id];
                    const customer = customerMap[property?.customer_id];
                    return `<article class="panel"><h3>${customer?.name ?? 'Unknown Customer'}</h3><p>${property?.service_address ?? 'Unknown address'}</p><p>${visit.service_description}</p><p>${property?.service_type ?? 'Service'} · ${property?.recurring_frequency ?? 'n/a'}</p><p>Price ${currency(visit.price)}</p><p>Notes: ${visit.notes || 'None'}</p><p>Status: ${visit.status}</p><div class="actions"><button data-visit-action="${visit.visit_id}:complete">Mark Completed</button><button data-visit-action="${visit.visit_id}:skip">Mark Skipped</button><button data-visit-action="${visit.visit_id}:skip-reschedule">Skip + Reschedule</button></div></article>`;
                  })
                  .join('')
              : '<article class="panel"><p>No visits found for this date.</p></article>'
          }
        </div>
      </section>
    `;
  }

  if (view === 'batch') {
    return `
      <section>
        <h2>Ready to Bill</h2>
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

  const routeDateInput = app.querySelector('#route-date');
  if (routeDateInput) {
    routeDateInput.addEventListener('change', () => {
      selectedRouteDate = routeDateInput.value;
      render();
    });
  }

  app.querySelectorAll('[data-visit-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const [visitId, action] = button.dataset.visitAction.split(':');
      if (action === 'complete') {
        state.visits = state.visits.map((visit) =>
          visit.visit_id === visitId ? { ...visit, status: 'completed' } : visit
        );
        flashMessage = `Visit ${visitId} marked completed.`;
      }

      if (action === 'skip') {
        state.visits = state.visits.map((visit) =>
          visit.visit_id === visitId ? { ...visit, status: 'skipped' } : visit
        );
        flashMessage = `Visit ${visitId} marked skipped.`;
      }

      if (action === 'skip-reschedule') {
        const sourceVisit = state.visits.find((visit) => visit.visit_id === visitId);
        if (!sourceVisit) return;
        const suggested = new Date(sourceVisit.visit_date);
        suggested.setDate(suggested.getDate() + 7);
        const suggestedDate = suggested.toISOString().slice(0, 10);
        const nextDate = window.prompt('Reschedule visit to date (YYYY-MM-DD):', suggestedDate);
        if (!nextDate) return;
        state.visits = state.visits.flatMap((visit) => {
          if (visit.visit_id !== visitId) return [visit];
          return [
            { ...visit, status: 'skipped' },
            {
              ...visit,
              visit_id: `visit_${crypto.randomUUID().slice(0, 8)}`,
              visit_date: nextDate,
              status: 'scheduled',
              created_at: new Date().toISOString()
            }
          ];
        });
        flashMessage = `Visit ${visitId} skipped and rescheduled to ${nextDate}.`;
      }
      saveState(state);
      render();
    });
  });

  const resetButton = app.querySelector('#reset-seed');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      state = resetSeed();
      selectedRouteDate = new Date().toISOString().slice(0, 10);
      flashMessage = 'Seed data restored.';
      render();
    });
  }

  app.querySelectorAll('[data-ledger]').forEach((button) => {
    button.addEventListener('click', () => {
      flashMessage = `Ledger view for customer ${button.dataset.ledger} is available in the customer ledger workflow.`;
      render();
    });
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

render();
