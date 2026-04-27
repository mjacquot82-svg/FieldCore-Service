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
let selectedCustomerId = '';
let selectedCustomerLetter = 'all';

const navItems = [
  ['dashboard', 'Dashboard'],
  ['today-route', 'Today’s Route'],
  ['customers', 'Customers'],
  ['batch', 'Ready to Bill'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['settings', 'Settings']
];

function currency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
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

function getCustomerSummary(customerId) {
  const properties = state.properties.filter((property) => property.customer_id === customerId);
  const propertyIds = new Set(properties.map((property) => property.property_id));
  const visits = state.visits.filter((visit) => propertyIds.has(visit.property_id));
  const lastVisit = visits
    .filter((visit) => Boolean(visit.visit_date))
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))[0];
  const activeRecurringServices = properties.filter(
    (property) =>
      property.status === 'active' &&
      property.recurring_frequency &&
      property.recurring_frequency !== 'none' &&
      property.recurring_frequency !== 'one-time'
  ).length;

  return {
    propertyCount: properties.length,
    activeRecurringServices,
    lastVisitDate: lastVisit?.visit_date ?? 'No visits yet'
  };
}

function getSelectedCustomer() {
  return selectedCustomerId ? state.customers.find((customer) => customer.customer_id === selectedCustomerId) : null;
}

function getCustomerProperties(customerId) {
  return state.properties.filter((property) => property.customer_id === customerId);
}

function getFilteredCustomers() {
  if (selectedCustomerLetter === 'all') return state.customers;
  return state.customers.filter((customer) => customer.name?.trim().toUpperCase().startsWith(selectedCustomerLetter));
}

function renderCustomerLetterFilter() {
  const letters = [...new Set(state.customers.map((customer) => customer.name?.trim().charAt(0).toUpperCase()).filter(Boolean))].sort();
  return `
    <div class="letter-filter panel">
      <button class="${selectedCustomerLetter === 'all' ? 'active' : ''}" data-letter-filter="all">All</button>
      ${letters
        .map(
          (letter) =>
            `<button class="${selectedCustomerLetter === letter ? 'active' : ''}" data-letter-filter="${letter}">${letter}</button>`
        )
        .join('')}
    </div>
  `;
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
      visit_id: makeId('visit'),
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
      <section><h2>Operations Dashboard</h2></section>
      <section class="panel">
        <h3>Today’s Priorities</h3>
        <ul>
          <li>${metrics.todayScheduledVisits} visits scheduled</li>
          <li>${metrics.overdueInvoices} invoices overdue</li>
          <li>${metrics.readyToBillVisits} visits ready to bill</li>
        </ul>
      </section>
      <section class="panel">
        <h3>Today’s Visits</h3>
        <div class="overview-cards">
          ${metricCard('Today Scheduled Visits', metrics.todayScheduledVisits)}
          ${metricCard('Today Completed Visits', metrics.todayCompletedVisits)}
          ${metricCard('Today Skipped Visits', metrics.todaySkippedVisits)}
        </div>
      </section>
      <section class="panel">
        <h3>Billing Queue</h3>
        <div class="overview-cards">
          ${metricCard('Ready-to-Bill Visits', metrics.readyToBillVisits)}
          ${metricCard('Ready-to-Bill Amount', currency(metrics.readyToBillAmount))}
        </div>
      </section>
      <section class="panel">
        <h3>Financial Snapshot</h3>
        <div class="overview-cards">
          ${metricCard('Total Outstanding', currency(metrics.totalOutstanding))}
          ${metricCard('Overdue Amount', currency(metrics.overdueAmount))}
          ${metricCard('Paid This Month', currency(metrics.paidThisMonth))}
        </div>
      </section>
    `;
  }

  if (view === 'customers') {
    const customers = getFilteredCustomers();
    return `<section><h2>Customers</h2>${renderCustomerLetterFilter()}<div class="stack">${customers.length
      ? customers
          .map((c) => {
            const balance = getCustomerBalance(c.customer_id);
            const summary = getCustomerSummary(c.customer_id);
            const paidUp = balance.outstanding <= 0;
            const overdue = balance.overdue > 0;
            return `<article class="panel customer-card"><div class="customer-card-header"><div><h3>${c.name}</h3><p>${c.phone} · ${c.email}</p></div><span class="badge ${c.status === 'active' ? 'paid-up' : 'outstanding'}">${c.status}</span></div><p>${c.billing_address}</p><div class="customer-overview"><div><span>Properties</span><strong>${summary.propertyCount}</strong></div><div><span>Active Services</span><strong>${summary.activeRecurringServices}</strong></div><div><span>Last Visit</span><strong>${summary.lastVisitDate}</strong></div></div><div class="balance-badges">${paidUp ? '<span class="badge paid-up">Paid up</span>' : `<span class="badge outstanding">Outstanding: ${currency(balance.outstanding)}</span>`}${overdue ? `<span class="badge overdue">Overdue: ${currency(balance.overdue)}</span>` : ''}</div><div class="actions"><button data-ledger="${c.customer_id}">View Ledger</button><button data-customer-nav="properties:${c.customer_id}">Manage Services</button><button data-customer-nav="visits:${c.customer_id}">View Visit History</button></div></article>`;
          })
          .join('')
      : '<article class="panel"><p>No customers found for this letter.</p></article>'}</div></section>`;
  }

  if (view === 'properties') {
    const selectedCustomer = getSelectedCustomer();
    const properties = selectedCustomerId ? getCustomerProperties(selectedCustomerId) : state.properties;
    return `<section><h2>${selectedCustomer ? `${selectedCustomer.name} Services / Service Locations` : 'Properties / Service Locations'}</h2>${selectedCustomer ? '<button class="primary" data-nav="customers">Back to Customers</button>' : ''}${
      selectedCustomer
        ? `<div class="service-layout">
            <form id="service-form" class="panel service-form">
              <h3>Add Recurring Service or Service Location</h3>
              <label>Service Location<input name="service_address" placeholder="123 Main St or Backyard" required /></label>
              <label>Service Type<input name="service_type" placeholder="Mowing, Garden Care, Snow Removal" required /></label>
              <label>Frequency<select name="recurring_frequency" required><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="one-time">One-time / odd job location</option></select></label>
              <label>Default Price<input name="default_price" type="number" min="0" step="0.01" required /></label>
              <label>Notes<input name="notes" placeholder="Gate code, preferred day, service notes" /></label>
              <button class="primary" type="submit">Add Service</button>
            </form>
            <form id="one-off-form" class="panel service-form">
              <h3>Schedule One-Off Job</h3>
              ${
                properties.length
                  ? `<label>Service Location<select name="property_id" required>${properties
                      .map((property) => `<option value="${property.property_id}">${property.service_address}</option>`)
                      .join('')}</select></label>`
                  : '<p>Add a service location before scheduling a one-off job.</p>'
              }
              <label>Job Date<input name="visit_date" type="date" required /></label>
              <label>Job Description<input name="service_description" placeholder="Mulch install, weeding, cleanup" required /></label>
              <label>Price<input name="price" type="number" min="0" step="0.01" required /></label>
              <label>Notes<input name="notes" placeholder="Materials, access notes, special instructions" /></label>
              <button class="primary" type="submit" ${properties.length ? '' : 'disabled'}>Schedule One-Off Job</button>
            </form>
          </div>`
        : ''
    }<div class="stack">${properties.length
      ? properties
          .map((p) => {
            const customer = customerMap[p.customer_id];
            return `<article class="panel"><div class="customer-card-header"><div><h3>${p.service_address}</h3><p>${customer?.name ?? 'Unknown Customer'}</p></div><span class="badge ${p.status === 'active' ? 'paid-up' : 'outstanding'}">${p.status}</span></div><p>${p.service_type} · ${p.recurring_frequency}</p><p>Default Price: ${currency(p.default_price)}</p><p>Notes: ${p.notes || 'None'}</p>${
              selectedCustomer
                ? `<div class="actions"><button data-service-edit="${p.property_id}">Change Service</button><button data-service-remove="${p.property_id}">Remove Service</button></div>`
                : ''
            }</article>`;
          })
          .join('')
      : '<article class="panel"><p>No properties found for this customer.</p></article>'}</div></section>`;
  }

  if (view === 'visits') {
    const selectedCustomer = getSelectedCustomer();
    const selectedPropertyIds = new Set(
      state.properties
        .filter((property) => !selectedCustomerId || property.customer_id === selectedCustomerId)
        .map((property) => property.property_id)
    );
    const visits = selectedCustomerId
      ? state.visits.filter((visit) => selectedPropertyIds.has(visit.property_id))
      : state.visits;
    return `<section><h2>${selectedCustomer ? `${selectedCustomer.name} Visit History` : 'Service Visits'}</h2>${selectedCustomer ? '<button class="primary" data-nav="customers">Back to Customers</button>' : ''}<div class="stack">${visits.length
      ? visits
          .map((v) => {
            const property = propertyMap[v.property_id];
            return `<article class="panel"><h3>${v.visit_date} · ${v.service_description}</h3><p>${property?.service_address ?? 'Unknown property'}</p><p>Price ${currency(v.price)} · Status: ${v.status}</p><p>Notes: ${v.notes || 'None'}</p></article>`;
          })
          .join('')
      : '<article class="panel"><p>No visits found for this customer.</p></article>'}</div></section>`;
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
      selectedCustomerId = '';
      flashMessage = '';
      render();
    });
  });

  app.querySelectorAll('[data-letter-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedCustomerLetter = button.dataset.letterFilter;
      render();
    });
  });

  app.querySelectorAll('[data-customer-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const [view, customerId] = button.dataset.customerNav.split(':');
      activeView = view;
      selectedCustomerId = customerId;
      flashMessage = '';
      render();
    });
  });

  const serviceForm = app.querySelector('#service-form');
  if (serviceForm && selectedCustomerId) {
    serviceForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(serviceForm);
      state.properties = [
        ...state.properties,
        {
          property_id: makeId('prop'),
          company_id: state.company.company_id,
          customer_id: selectedCustomerId,
          service_address: formData.get('service_address'),
          service_type: formData.get('service_type'),
          recurring_frequency: formData.get('recurring_frequency'),
          default_price: Number(formData.get('default_price') || 0),
          status: 'active',
          notes: formData.get('notes') || '',
          created_at: new Date().toISOString()
        }
      ];
      saveState(state);
      flashMessage = 'Service added.';
      render();
    });
  }

  const oneOffForm = app.querySelector('#one-off-form');
  if (oneOffForm && selectedCustomerId) {
    oneOffForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(oneOffForm);
      state.visits = [
        ...state.visits,
        {
          visit_id: makeId('visit'),
          company_id: state.company.company_id,
          property_id: formData.get('property_id'),
          visit_date: formData.get('visit_date'),
          service_description: formData.get('service_description'),
          price: Number(formData.get('price') || 0),
          status: 'scheduled',
          notes: formData.get('notes') || 'One-off job',
          created_at: new Date().toISOString()
        }
      ];
      saveState(state);
      flashMessage = 'One-off job scheduled.';
      render();
    });
  }

  app.querySelectorAll('[data-service-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const propertyId = button.dataset.serviceEdit;
      const property = state.properties.find((item) => item.property_id === propertyId);
      if (!property) return;

      const serviceType = window.prompt('Service type:', property.service_type);
      if (!serviceType) return;
      const frequency = window.prompt('Frequency (weekly, biweekly, monthly, one-time):', property.recurring_frequency);
      if (!frequency) return;
      const price = window.prompt('Default price:', property.default_price);
      if (price === null) return;
      const notes = window.prompt('Notes:', property.notes || '');
      if (notes === null) return;
      const status = window.prompt('Status (active or inactive):', property.status || 'active');
      if (!status) return;

      state.properties = state.properties.map((item) =>
        item.property_id === propertyId
          ? {
              ...item,
              service_type: serviceType,
              recurring_frequency: frequency,
              default_price: Number(price || 0),
              notes,
              status
            }
          : item
      );
      saveState(state);
      flashMessage = 'Service updated.';
      render();
    });
  });

  app.querySelectorAll('[data-service-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      const propertyId = button.dataset.serviceRemove;
      const property = state.properties.find((item) => item.property_id === propertyId);
      if (!property) return;
      const confirmed = window.confirm(`Remove ${property.service_type} at ${property.service_address}? This will mark the service inactive and keep history.`);
      if (!confirmed) return;

      state.properties = state.properties.map((item) =>
        item.property_id === propertyId ? { ...item, status: 'inactive' } : item
      );
      saveState(state);
      flashMessage = 'Service removed from active work.';
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
      selectedCustomerId = '';
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
              visit_id: makeId('visit'),
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
      selectedCustomerId = '';
      selectedCustomerLetter = 'all';
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
