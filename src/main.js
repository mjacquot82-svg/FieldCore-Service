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
import { getSession, clearSession, renderLogin } from './role-pin-login.js';
import { renderRouteBuilder, bindRouteBuilderEvents } from './route-builder.js';
import { renderEmployees, bindEmployeeEvents } from './employees.js';

const app = document.querySelector('#app');
let state = loadState();
let currentSession = getSession();
let activeView = currentSession?.role === 'employee' ? 'worker-route' : 'dashboard';
let flashMessage = '';
let selectedRouteDate = new Date().toISOString().slice(0, 10);
let selectedRouteBuilderDate = new Date().toISOString().slice(0, 10);
let selectedCustomerId = '';
let selectedCustomerLetter = 'all';
let showOverdueRoute = false;

const ALL_NAV_ITEMS = [
  ['dashboard', 'Dashboard'],
  ['today-route', 'Today’s Route'],
  ['route-builder', 'Route Builder'],
  ['employees', 'Employees'],
  ['customers', 'Customers'],
  ['batch', 'Ready to Bill'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['settings', 'Settings']
];

function getNavItems(session) {
  if (session?.role === 'employee') {
    return [['worker-route', 'My Route']];
  }
  return ALL_NAV_ITEMS;
}


const currency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);
const customerProperties = (customerId) => state.properties.filter((p) => p.customer_id === customerId);
const selectedCustomer = () => state.customers.find((c) => c.customer_id === selectedCustomerId);

function getCustomerBalance(customerId) {
  const currentDate = today();
  return state.invoices.reduce((totals, invoice) => {
    if (invoice.customer_id !== customerId || invoice.payment_status === 'paid') return totals;
    const remaining = Number((invoice.total - (invoice.amount_paid || 0)).toFixed(2));
    if (remaining <= 0) return totals;
    totals.outstanding += remaining;
    if (invoice.payment_status === 'overdue' || invoice.due_date < currentDate) totals.overdue += remaining;
    return totals;
  }, { outstanding: 0, overdue: 0 });
}

function getCustomerSummary(customerId) {
  const properties = customerProperties(customerId);
  const propertyIds = new Set(properties.map((p) => p.property_id));
  const visits = state.visits.filter((v) => propertyIds.has(v.property_id));
  const lastVisit = visits.filter((v) => v.visit_date).sort((a, b) => b.visit_date.localeCompare(a.visit_date))[0];
  const activeRecurringServices = properties.filter((p) => p.status === 'active' && p.recurring_frequency && !['none', 'one-time'].includes(p.recurring_frequency)).length;
  return { propertyCount: properties.length, activeRecurringServices, lastVisitDate: lastVisit?.visit_date ?? 'No visits yet' };
}

function getFilteredCustomers() {
  if (selectedCustomerLetter === 'all') return state.customers;
  return state.customers.filter((c) => c.name?.trim().toUpperCase().startsWith(selectedCustomerLetter));
}

function renderCustomerLetterFilter() {
  const letters = [...new Set(state.customers.map((c) => c.name?.trim().charAt(0).toUpperCase()).filter(Boolean))].sort();
  return `<div class="letter-filter panel"><button class="${selectedCustomerLetter === 'all' ? 'active' : ''}" data-letter-filter="all">All</button>${letters.map((l) => `<button class="${selectedCustomerLetter === l ? 'active' : ''}" data-letter-filter="${l}">${l}</button>`).join('')}</div>`;
}

function renderCustomerForm() {
  return `<form id="customer-form" class="panel service-form"><h3>Add Customer</h3><label>Name<input name="name" placeholder="Customer or business name" required /></label><label>Phone<input name="phone" placeholder="555-123-4567" /></label><label>Email<input name="email" type="email" placeholder="customer@example.com" /></label><label>Billing Address<input name="billing_address" placeholder="Billing address" /></label><button class="primary" type="submit">Add Customer</button></form>`;
}

function buildCustomerTimeline(customerId, customerMap, propertyMap) {
  const properties = customerProperties(customerId);
  const propertyIds = new Set(properties.map((p) => p.property_id));
  const invoices = state.invoices.filter((i) => i.customer_id === customerId);
  const invoiceIds = new Set(invoices.map((i) => i.invoice_id));
  const invoiceNumbers = new Set(invoices.map((i) => i.invoice_number).filter(Boolean));
  const serviceEvents = properties.map((p) => ({
    date: p.created_at?.slice(0, 10) || 'Unknown date',
    type: p.status === 'inactive' ? 'Service removed' : 'Service added',
    title: `${p.service_type} at ${p.service_address}`,
    detail: `${p.recurring_frequency || 'Service'} · ${currency(p.default_price)}${p.notes ? ` · ${p.notes}` : ''}`
  }));
  const visitEvents = state.visits.filter((v) => propertyIds.has(v.property_id)).map((v) => ({
    date: v.visit_date || v.created_at?.slice(0, 10) || 'Unknown date',
    type: `Visit ${v.status}`,
    title: v.service_description,
    detail: `${propertyMap[v.property_id]?.service_address ?? 'Unknown property'} · ${currency(v.price)}${v.notes ? ` · ${v.notes}` : ''}`
  }));
  const invoiceEvents = invoices.map((i) => ({
    date: i.invoice_date || i.created_at?.slice(0, 10) || i.due_date || 'Unknown date',
    type: 'Invoice',
    title: `${i.invoice_number} · ${i.payment_status}`,
    detail: `${customerMap[i.customer_id]?.name ?? i.customer_name ?? 'Customer'} · ${currency(i.total)} · Due ${i.due_date || 'n/a'}`
  }));
  const paymentEvents = (state.payments || [])
    .filter((p) => p.customer_id === customerId || (p.invoice_id && invoiceIds.has(p.invoice_id)) || (p.invoice_number && invoiceNumbers.has(p.invoice_number)))
    .map((p) => ({
      date: p.payment_date || p.created_at?.slice(0, 10) || 'Unknown date',
      type: 'Payment',
      title: `Payment received · ${currency(p.amount)}`,
      detail: p.method || p.notes || 'Payment recorded'
    }));
  const customer = state.customers.find((c) => c.customer_id === customerId);
  const customerEvent = customer ? [{
    date: customer.created_at?.slice(0, 10) || 'Unknown date',
    type: customer.status === 'inactive' ? 'Customer inactive' : 'Customer added',
    title: customer.name,
    detail: `${customer.phone || 'No phone'} · ${customer.email || 'No email'}`
  }] : [];
  return [...customerEvent, ...serviceEvents, ...visitEvents, ...invoiceEvents, ...paymentEvents].sort((a, b) => {
    if (a.date === 'Unknown date') return 1;
    if (b.date === 'Unknown date') return -1;
    return b.date.localeCompare(a.date);
  });
}

function ensureRouteVisitsForDate(targetDate) {
  const customerMap = getCustomerMap(state);
  const recurringFrequencies = new Set(['weekly', 'biweekly', 'monthly']);
  const newVisits = [];
  state.properties.forEach((property) => {
    const customer = customerMap[property.customer_id];
    if (property.company_id !== state.company.company_id || property.status !== 'active') return;
    if (!recurringFrequencies.has(property.recurring_frequency) || !customer || customer.status !== 'active') return;
    const exists = state.visits.some((visit) => visit.property_id === property.property_id && visit.visit_date === targetDate);
    if (exists) return;
    newVisits.push({ visit_id: makeId('visit'), company_id: state.company.company_id, property_id: property.property_id, visit_date: targetDate, service_description: `${property.recurring_frequency} ${property.service_type.toLowerCase()} service`, price: property.default_price, status: 'scheduled', notes: property.notes || 'Auto-generated recurring visit.', created_at: new Date().toISOString() });
  });
  if (newVisits.length) state.visits = [...state.visits, ...newVisits];
  return newVisits.length;
}

function getScheduledVisitsForProperty(propertyId) {
  return state.visits
    .filter((v) => v.property_id === propertyId && v.status === 'scheduled' && v.visit_date)
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date));
}

function getOverdueScheduledVisits() {
  const currentDate = today();
  return state.visits
    .filter((v) => v.status === 'scheduled' && v.visit_date && v.visit_date < currentDate)
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date));
}

function renderVisitStatusLine(propertyId) {
  const currentDate = today();
  const scheduledVisits = getScheduledVisitsForProperty(propertyId);
  const overdueVisit = scheduledVisits.find((v) => v.visit_date < currentDate);
  if (overdueVisit) return `<p><span class="badge overdue">⚠ Overdue since ${overdueVisit.visit_date}</span></p>`;
  const nextVisit = scheduledVisits.find((v) => v.visit_date >= currentDate);
  if (nextVisit) return `<p><span class="badge paid-up">Next visit: ${nextVisit.visit_date}</span></p>`;
  return '<p><span class="badge outstanding">Next visit: none scheduled</span></p>';
}

function renderOverdueVisitBanner(propertyMap, customerMap) {
  const overdueVisits = getOverdueScheduledVisits();
  if (!overdueVisits.length) return '';
  const firstVisit = overdueVisits[0];
  const property = propertyMap[firstVisit.property_id];
  const customer = customerMap[property?.customer_id];
  const plural = overdueVisits.length === 1 ? 'visit is' : 'visits are';
  const example = property ? ` Oldest: ${customer?.name ?? 'Unknown customer'} · ${property.service_address} · ${firstVisit.visit_date}.` : '';
  return `<div class="flash overdue-alert">⚠ ${overdueVisits.length} scheduled ${plural} overdue.${example} <button class="primary" data-overdue-visits>View overdue visits</button></div>`;
}

function renderPropertyQuickActionCards(properties, customerMap) {
  if (!properties.length) return '<article class="panel"><p>No service locations found for this customer.</p></article>';
  return properties.map((p) => `<article class="panel"><div class="customer-card-header"><div><h3>${p.service_address}</h3><p>${customerMap[p.customer_id]?.name ?? 'Unknown Customer'}</p></div><span class="badge ${p.status === 'active' ? 'paid-up' : 'outstanding'}">${p.status}</span></div><p>${p.service_type} · ${p.recurring_frequency}</p>${renderVisitStatusLine(p.property_id)}<p>Default Price: ${currency(p.default_price)}</p><p>Notes: ${p.notes || 'None'}</p><div class="actions"><button data-service-schedule="${p.property_id}">Schedule Visit</button><button data-service-pause="${p.property_id}">Pause Service</button><button data-service-frequency="${p.property_id}">Change Frequency</button><button data-service-price="${p.property_id}">Adjust Price</button></div></article>`).join('');
}

function render() {
  currentSession = getSession();
  if (!currentSession) {
    renderLogin();
    return;
  }

  if (currentSession.role === 'employee') {
    activeView = 'worker-route';
  } else if (activeView === 'worker-route') {
    activeView = 'dashboard';
  }

  if (activeView === 'today-route' && !showOverdueRoute) {
    const createdCount = ensureRouteVisitsForDate(selectedRouteDate);
    if (createdCount > 0) saveState(state);
  }

  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const metrics = computeDashboard(state);
  const companyName = state.company?.name?.trim() || 'ServiceBatch';
  const navItems = getNavItems(currentSession);
  const sessionBanner = renderSessionBanner(currentSession);
  const overdueBanner = currentSession.role === 'employee' ? '' : renderOverdueVisitBanner(propertyMap, customerMap);

  app.innerHTML = `<div class="layout"><aside class="sidebar"><h1>${companyName}</h1><nav>${navItems.map(([id, label]) => `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${id}">${label}</button>`).join('')}</nav></aside><main class="content">${sessionBanner}${flashMessage ? `<div class="flash">${flashMessage}</div>` : ''}${overdueBanner}${renderView(activeView, metrics, customerMap, propertyMap)}</main><nav class="bottom-nav">${navItems.map(([id, label]) => `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${id}">${label}</button>`).join('')}</nav></div>`;
  bindEvents();
}

function renderView(view, metrics, customerMap, propertyMap) {
  if (view === 'dashboard') return renderDashboard(metrics);
  if (view === 'worker-route') return renderWorkerRoute(currentSession);
  if (view === 'route-builder') return renderRouteBuilder(state, selectedRouteBuilderDate);
  if (view === 'employees') return renderEmployees();
  if (view === 'customers') return renderCustomers();
  if (view === 'timeline') return renderTimeline(customerMap, propertyMap);
  if (view === 'properties') return renderProperties(customerMap);
  if (view === 'visits') return renderTimeline(customerMap, propertyMap);
  if (view === 'today-route') return renderTodayRoute(customerMap, propertyMap);
  if (view === 'batch') return renderBatch();
  if (view === 'invoices') return renderInvoices(customerMap);
  if (view === 'payments') return renderPayments(customerMap);
  return renderSettings();
}

function renderDashboard(metrics) {
  return `<section><h2>Operations Dashboard</h2></section><section class="panel"><h3>Today’s Priorities</h3><ul><li>${metrics.todayScheduledVisits} visits scheduled</li><li>${metrics.overdueInvoices} invoices overdue</li><li>${metrics.readyToBillVisits} visits ready to bill</li></ul></section><section class="panel"><h3>Today’s Visits</h3><div class="overview-cards">${metricCard('Today Scheduled Visits', metrics.todayScheduledVisits)}${metricCard('Today Completed Visits', metrics.todayCompletedVisits)}${metricCard('Today Skipped Visits', metrics.todaySkippedVisits)}</div></section><section class="panel"><h3>Billing Queue</h3><div class="overview-cards">${metricCard('Ready-to-Bill Visits', metrics.readyToBillVisits)}${metricCard('Ready-to-Bill Amount', currency(metrics.readyToBillAmount))}</div></section><section class="panel"><h3>Financial Snapshot</h3><div class="overview-cards">${metricCard('Total Outstanding', currency(metrics.totalOutstanding))}${metricCard('Overdue Amount', currency(metrics.overdueAmount))}${metricCard('Paid This Month', currency(metrics.paidThisMonth))}</div></section>`;
}

function renderCustomers() {
  const customers = getFilteredCustomers();
  return `<section><h2>Customers</h2>${renderCustomerForm()}${renderCustomerLetterFilter()}<div class="stack">${customers.length ? customers.map((c) => {
    const balance = getCustomerBalance(c.customer_id);
    const summary = getCustomerSummary(c.customer_id);
    const paidUp = balance.outstanding <= 0;
    const overdue = balance.overdue > 0;
    return `<article class="panel customer-card"><div class="customer-card-header"><div><h3>${c.name}</h3><p>${c.phone || 'No phone'} · ${c.email || 'No email'}</p></div><span class="badge ${c.status === 'active' ? 'paid-up' : 'outstanding'}">${c.status}</span></div><p>${c.billing_address || 'No billing address'}</p><div class="customer-overview"><div><span>Properties</span><strong>${summary.propertyCount}</strong></div><div><span>Active Services</span><strong>${summary.activeRecurringServices}</strong></div><div><span>Last Activity</span><strong>${summary.lastVisitDate}</strong></div></div><div class="balance-badges">${paidUp ? '<span class="badge paid-up">Paid up</span>' : `<span class="badge outstanding">Outstanding: ${currency(balance.outstanding)}</span>`}${overdue ? `<span class="badge overdue">Overdue: ${currency(balance.overdue)}</span>` : ''}</div><div class="actions"><button data-ledger="${c.customer_id}">View Ledger</button><button data-customer-nav="properties:${c.customer_id}">Manage Services</button><button data-customer-nav="timeline:${c.customer_id}">Customer Activity</button><button data-customer-edit="${c.customer_id}">Edit Customer</button><button data-customer-remove="${c.customer_id}">Remove Customer</button></div></article>`;
  }).join('') : '<article class="panel"><p>No customers found for this letter.</p></article>'}</div></section>`;
}

function renderTimeline(customerMap, propertyMap) {
  const customer = selectedCustomer();
  const properties = customer ? customerProperties(customer.customer_id) : [];
  const events = customer ? buildCustomerTimeline(customer.customer_id, customerMap, propertyMap) : [];
  const quickActions = customer ? `<div class="actions" style="margin: 0.75rem 0;"><button data-customer-nav="properties:${customer.customer_id}">+ Add Service</button><button data-customer-nav="properties:${customer.customer_id}">+ Schedule Visit</button><button data-nav="batch">Create Invoice</button><button data-nav="payments">Record Payment</button></div>` : '';
  const serviceLocationCards = customer ? `<h3>Service Locations</h3><div class="stack">${renderPropertyQuickActionCards(properties, customerMap)}</div>` : '';
  return `<section><h2>${customer ? `${customer.name} Customer Activity` : 'Customer Activity'}</h2><button class="primary" data-nav="customers">Back to Customers</button>${quickActions}${serviceLocationCards}<h3>Activity Timeline</h3><div class="stack timeline-stack">${events.length ? events.map((event) => `<article class="panel timeline-event"><div class="timeline-date">${event.date}</div><div><span class="badge outstanding">${event.type}</span><h3>${event.title}</h3><p>${event.detail}</p></div></article>`).join('') : '<article class="panel"><p>No customer activity found yet.</p></article>'}</div></section>`;
}

function renderProperties(customerMap) {
  const customer = selectedCustomer();
  const properties = selectedCustomerId ? customerProperties(selectedCustomerId) : state.properties;
  const serviceForms = customer ? `<div class="service-layout"><form id="service-form" class="panel service-form"><h3>Add Recurring Service or Service Location</h3><label>Service Location<input name="service_address" placeholder="123 Main St or Backyard" required /></label><label>Service Type<input name="service_type" placeholder="Mowing, Garden Care, Snow Removal" required /></label><label>Frequency<select name="recurring_frequency" required><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="one-time">One-time / odd job location</option></select></label><label>Default Price<input name="default_price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Gate code, preferred day, service notes" /></label><button class="primary" type="submit">Add Service</button></form><form id="one-off-form" class="panel service-form"><h3>Schedule One-Off Job</h3>${properties.length ? `<label>Service Location<select name="property_id" required>${properties.map((p) => `<option value="${p.property_id}">${p.service_address}</option>`).join('')}</select></label>` : '<p>Add a service location before scheduling a one-off job.</p>'}<label>Job Date<input name="visit_date" type="date" required /></label><label>Job Description<input name="service_description" placeholder="Mulch install, weeding, cleanup" required /></label><label>Price<input name="price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Materials, access notes, special instructions" /></label><button class="primary" type="submit" ${properties.length ? '' : 'disabled'}>Schedule One-Off Job</button></form></div>` : '';
  return `<section><h2>${customer ? `${customer.name} Services / Service Locations` : 'Properties / Service Locations'}</h2>${customer ? '<button class="primary" data-nav="customers">Back to Customers</button>' : ''}${serviceForms}<div class="stack">${properties.length ? properties.map((p) => `<article class="panel"><div class="customer-card-header"><div><h3>${p.service_address}</h3><p>${customerMap[p.customer_id]?.name ?? 'Unknown Customer'}</p></div><span class="badge ${p.status === 'active' ? 'paid-up' : 'outstanding'}">${p.status}</span></div><p>${p.service_type} · ${p.recurring_frequency}</p>${renderVisitStatusLine(p.property_id)}<p>Default Price: ${currency(p.default_price)}</p><p>Notes: ${p.notes || 'None'}</p>${customer ? `<div class="actions"><button data-service-edit="${p.property_id}">Change Service</button><button data-service-remove="${p.property_id}">Remove Service</button></div>` : ''}</article>`).join('') : '<article class="panel"><p>No properties found for this customer.</p></article>'}</div></section>`;
}

function renderTodayRoute(customerMap, propertyMap) {
  const routeVisits = showOverdueRoute ? getOverdueScheduledVisits() : state.visits.filter((v) => v.visit_date === selectedRouteDate);
  const heading = showOverdueRoute ? 'Overdue Visits' : 'Today’s Route / Daily Work List';
  const emptyText = showOverdueRoute ? 'No overdue visits found.' : 'No visits found for this date.';
  const dateControl = showOverdueRoute
    ? '<div class="panel"><p>Showing scheduled visits older than today.</p><button data-clear-overdue-route>Back to selected date</button></div>'
    : `<div class="panel"><label>Select Date<input type="date" id="route-date" value="${selectedRouteDate}" /></label></div>`;
  return `<section><h2>${heading}</h2>${dateControl}<div class="stack">${routeVisits.length ? routeVisits.map((v) => { const property = propertyMap[v.property_id]; const customer = customerMap[property?.customer_id]; return `<article class="panel"><h3>${customer?.name ?? 'Unknown Customer'}</h3><p>${property?.service_address ?? 'Unknown address'}</p><p>${v.service_description}</p><p>${property?.service_type ?? 'Service'} · ${property?.recurring_frequency ?? 'n/a'}</p><p>Visit date ${v.visit_date}</p><p>Price ${currency(v.price)}</p><p>Notes: ${v.notes || 'None'}</p><p>Status: ${v.status}</p><div class="actions"><button data-visit-action="${v.visit_id}:complete">Mark Completed</button><button data-visit-action="${v.visit_id}:skip">Mark Skipped</button><button data-visit-action="${v.visit_id}:skip-reschedule">Skip + Reschedule</button></div></article>`; }).join('') : `<article class="panel"><p>${emptyText}</p></article>`}</div></section>`;
}

function renderSessionBanner(session) {
  return `
    <div class="flash session-banner">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
        <div><strong>${session.name}</strong> <span style="color:#475569;font-size:0.95rem;">(${session.role})</span></div>
        <button data-logout class="primary">Logout</button>
      </div>
    </div>
  `;
}

function renderWorkerStop(visit, customers, properties, index) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const serviceText = visit.service_description || property?.service_type || 'Service';
  const statusLabel = visit.status === 'in-progress' ? 'In progress' : visit.status === 'completed' ? 'Completed' : visit.status === 'skipped' ? 'Skipped' : 'Scheduled';
  const statusClass = visit.status === 'completed' ? 'completed' : visit.status === 'skipped' ? 'skipped' : visit.status === 'in-progress' ? 'current' : '';
  const actions = [];

  if (visit.status === 'scheduled') {
    actions.push(`<button type="button" data-worker-action="${visit.visit_id}:start">Start Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${visit.visit_id}:complete">Complete Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${visit.visit_id}:skip">Skip Stop</button>`);
  } else if (visit.status === 'in-progress') {
    actions.push(`<button type="button" data-worker-action="${visit.visit_id}:complete">Complete Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${visit.visit_id}:skip">Skip Stop</button>`);
  }

  return `
    <article class="panel route-flow-stop ${statusClass}">
      <div class="route-stop-index">
        <p class="route-stop-kicker">Stop ${index + 1}</p>
        <span>${statusLabel}</span>
      </div>
      <div class="route-stop-main-detail">
        <h3>${customer?.name || 'Unknown Customer'}</h3>
        <p class="route-stop-address">${property?.service_address || 'Unknown address'}</p>
        <p class="route-stop-service">${serviceText}</p>
        <p>${property?.service_type || 'Service'} · ${property?.recurring_frequency || 'n/a'}</p>
        <p>${visit.notes || 'No notes provided.'}</p>
      </div>
      <div class="actions route-stop-actions">
        ${actions.join('')}
      </div>
    </article>
  `;
}

function renderWorkerRoute(session) {
  if (!session) return '<section><p>Worker session required.</p></section>';
  const todayDate = today();
  const customers = getCustomerMap(state);
  const properties = getPropertyMap(state);
  const assignedVisits = state.visits.filter((visit) => visit.visit_date === todayDate && visit.assigned_worker === session.name);
  const completed = assignedVisits.filter((visit) => visit.status === 'completed').length;
  const remaining = assignedVisits.filter((visit) => !['completed', 'skipped'].includes(visit.status)).length;

  return `
    <section>
      <h2>My Route</h2>
      <p class="section-description">Assigned stops for ${todayDate}</p>
      <div class="route-stat-grid">
        ${metricCard('Total stops', assignedVisits.length)}
        ${metricCard('Completed', completed)}
        ${metricCard('Remaining', remaining)}
      </div>
      <div class="stack route-flow-list">
        ${assignedVisits.length ? assignedVisits.map((visit, index) => renderWorkerStop(visit, customers, properties, index)).join('') : '<article class="panel"><p>No assigned stops for today.</p></article>'}
      </div>
    </section>
  `;
}

function updateWorkerVisitStatus(visitId, action) {
  state.visits = state.visits.map((visit) => {
    if (visit.visit_id !== visitId) return visit;
    if (action === 'start') return { ...visit, status: 'in-progress', started_at: new Date().toISOString() };
    if (action === 'complete') return { ...visit, status: 'completed', completed_at: new Date().toISOString() };
    if (action === 'skip') return { ...visit, status: 'skipped', skipped_at: new Date().toISOString() };
    return visit;
  });
  saveState(state);
}

function renderBatch() {
  return `<section><h2>Ready to Bill</h2><p>Select a date range to invoice completed, unbilled visits and group by customer.</p><form id="batch-form" class="panel"><label>Start Date<input type="date" name="start" value="2026-04-01" required/></label><label>End Date<input type="date" name="end" value="2026-04-30" required/></label><button class="primary" type="submit">Generate Batch Invoices</button></form></section>`;
}

function renderInvoices(customerMap) {
  return `<section><h2>Invoices</h2><div class="stack">${state.invoices.map((i) => `<article class="panel"><h3>${i.invoice_number}</h3><p>${customerMap[i.customer_id]?.name ?? i.customer_name}</p><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p><p>Status: ${i.payment_status} · Due ${i.due_date}</p></article>`).join('')}</div></section>`;
}

function renderPayments(customerMap) {
  const invoices = state.invoices.filter((i) => i.payment_status !== 'paid');
  const overdue = invoices.filter((i) => i.payment_status === 'overdue');
  return `<section><h2>Payments / Outstanding Tracking</h2><p>Outstanding Balance: <strong>${currency(computeDashboard(state).totalOutstanding)}</strong></p><h3>Unpaid Invoices</h3><div class="stack">${invoices.map((i) => `<article class="panel"><h4>${i.invoice_number} · ${customerMap[i.customer_id]?.name ?? i.customer_name}</h4><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p><div class="actions"><button data-pay="${i.invoice_id}:partial">Mark Partial</button><button data-pay="${i.invoice_id}:paid">Mark Paid</button></div></article>`).join('')}</div><h3>Overdue Invoices</h3><ul>${overdue.map((i) => `<li>${i.invoice_number} - ${currency(i.total - (i.amount_paid || 0))}</li>`).join('')}</ul></section>`;
}

function renderSettings() {
  return `<section><h2>Settings</h2><article class="panel"><p>Company: ${state.company.name}</p><p>Company ID: ${state.company.company_id}</p><p>Invoice Prefix: ${state.settings.invoice_prefix}</p><p>Tax Rate: ${(state.settings.tax_rate * 100).toFixed(1)}%</p><button id="reset-seed">Reset Demo Data</button></article></section>`;
}

function metricCard(label, value) {
  return `<article class="card"><p>${label}</p><strong>${value}</strong></article>`;
}

function bindEvents() {
  app.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => { activeView = button.dataset.nav; selectedCustomerId = ''; showOverdueRoute = false; flashMessage = ''; render(); }));
  app.querySelectorAll('[data-overdue-visits]').forEach((button) => button.addEventListener('click', () => { activeView = 'today-route'; selectedCustomerId = ''; showOverdueRoute = true; flashMessage = 'Showing overdue visits.'; render(); }));
  app.querySelectorAll('[data-clear-overdue-route]').forEach((button) => button.addEventListener('click', () => { showOverdueRoute = false; flashMessage = ''; render(); }));
  app.querySelectorAll('[data-letter-filter]').forEach((button) => button.addEventListener('click', () => { selectedCustomerLetter = button.dataset.letterFilter; render(); }));
  app.querySelectorAll('[data-customer-nav]').forEach((button) => button.addEventListener('click', () => { const [view, customerId] = button.dataset.customerNav.split(':'); activeView = view; selectedCustomerId = customerId; showOverdueRoute = false; flashMessage = ''; render(); }));
  const customerForm = app.querySelector('#customer-form');
  if (customerForm) customerForm.addEventListener('submit', (event) => { event.preventDefault(); const formData = new FormData(customerForm); const name = String(formData.get('name') || '').trim(); if (!name) return; state.customers = [...state.customers, { customer_id: makeId('cust'), company_id: state.company.company_id, name, phone: formData.get('phone') || '', email: formData.get('email') || '', billing_address: formData.get('billing_address') || '', status: 'active', created_at: new Date().toISOString() }]; selectedCustomerLetter = 'all'; saveState(state); flashMessage = 'Customer added.'; render(); });
  app.querySelectorAll('[data-customer-edit]').forEach((button) => button.addEventListener('click', () => { const customerId = button.dataset.customerEdit; const customer = state.customers.find((c) => c.customer_id === customerId); if (!customer) return; const name = window.prompt('Customer name:', customer.name); if (!name) return; const phone = window.prompt('Phone:', customer.phone || ''); if (phone === null) return; const email = window.prompt('Email:', customer.email || ''); if (email === null) return; const billingAddress = window.prompt('Billing address:', customer.billing_address || ''); if (billingAddress === null) return; const status = window.prompt('Status (active or inactive):', customer.status || 'active'); if (!status) return; state.customers = state.customers.map((c) => c.customer_id === customerId ? { ...c, name, phone, email, billing_address: billingAddress, status } : c); saveState(state); flashMessage = 'Customer updated.'; render(); }));
  app.querySelectorAll('[data-customer-remove]').forEach((button) => button.addEventListener('click', () => { const customerId = button.dataset.customerRemove; const customer = state.customers.find((c) => c.customer_id === customerId); if (!customer) return; if (!window.confirm(`Remove ${customer.name}? This will mark the customer inactive and keep history.`)) return; state.customers = state.customers.map((c) => c.customer_id === customerId ? { ...c, status: 'inactive' } : c); state.properties = state.properties.map((p) => p.customer_id === customerId ? { ...p, status: 'inactive' } : p); saveState(state); flashMessage = 'Customer removed from active work.'; render(); }));
  const serviceForm = app.querySelector('#service-form');
  if (serviceForm && selectedCustomerId) serviceForm.addEventListener('submit', (event) => { event.preventDefault(); const formData = new FormData(serviceForm); state.properties = [...state.properties, { property_id: makeId('prop'), company_id: state.company.company_id, customer_id: selectedCustomerId, service_address: formData.get('service_address'), service_type: formData.get('service_type'), recurring_frequency: formData.get('recurring_frequency'), default_price: Number(formData.get('default_price') || 0), status: 'active', notes: formData.get('notes') || '', created_at: new Date().toISOString() }]; saveState(state); flashMessage = 'Service added.'; render(); });
  const oneOffForm = app.querySelector('#one-off-form');
  if (oneOffForm && selectedCustomerId) oneOffForm.addEventListener('submit', (event) => { event.preventDefault(); const formData = new FormData(oneOffForm); state.visits = [...state.visits, { visit_id: makeId('visit'), company_id: state.company.company_id, property_id: formData.get('property_id'), visit_date: formData.get('visit_date'), service_description: formData.get('service_description'), price: Number(formData.get('price') || 0), status: 'scheduled', notes: formData.get('notes') || 'One-off job', created_at: new Date().toISOString() }]; saveState(state); flashMessage = 'One-off job scheduled.'; render(); });
  app.querySelectorAll('[data-service-schedule]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.serviceSchedule; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const visitDate = window.prompt('Schedule visit date (YYYY-MM-DD):', today()); if (!visitDate) return; const description = window.prompt('Visit description:', `${property.service_type} service`); if (!description) return; const price = window.prompt('Visit price:', property.default_price); if (price === null) return; const notes = window.prompt('Visit notes:', property.notes || ''); if (notes === null) return; state.visits = [...state.visits, { visit_id: makeId('visit'), company_id: state.company.company_id, property_id: property.property_id, visit_date: visitDate, service_description: description, price: Number(price || 0), status: 'scheduled', notes, created_at: new Date().toISOString() }]; saveState(state); flashMessage = `Visit scheduled for ${visitDate}.`; render(); }));
  app.querySelectorAll('[data-service-pause]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.servicePause; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; if (!window.confirm(`Pause service at ${property.service_address}?`)) return; state.properties = state.properties.map((p) => p.property_id === propertyId ? { ...p, status: 'inactive' } : p); saveState(state); flashMessage = 'Service paused.'; render(); }));
  app.querySelectorAll('[data-service-frequency]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.serviceFrequency; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const frequency = window.prompt('Frequency (weekly, biweekly, monthly, one-time):', property.recurring_frequency); if (!frequency) return; state.properties = state.properties.map((p) => p.property_id === propertyId ? { ...p, recurring_frequency: frequency } : p); saveState(state); flashMessage = 'Service frequency updated.'; render(); }));
  app.querySelectorAll('[data-service-price]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.servicePrice; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const price = window.prompt('Default price:', property.default_price); if (price === null) return; state.properties = state.properties.map((p) => p.property_id === propertyId ? { ...p, default_price: Number(price || 0) } : p); saveState(state); flashMessage = 'Service price updated.'; render(); }));
  app.querySelectorAll('[data-service-edit]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.serviceEdit; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const serviceType = window.prompt('Service type:', property.service_type); if (!serviceType) return; const frequency = window.prompt('Frequency (weekly, biweekly, monthly, one-time):', property.recurring_frequency); if (!frequency) return; const price = window.prompt('Default price:', property.default_price); if (price === null) return; const notes = window.prompt('Notes:', property.notes || ''); if (notes === null) return; const status = window.prompt('Status (active or inactive):', property.status || 'active'); if (!status) return; state.properties = state.properties.map((p) => p.property_id === propertyId ? { ...p, service_type: serviceType, recurring_frequency: frequency, default_price: Number(price || 0), notes, status } : p); saveState(state); flashMessage = 'Service updated.'; render(); }));
  app.querySelectorAll('[data-service-remove]').forEach((button) => button.addEventListener('click', () => { const propertyId = button.dataset.serviceRemove; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; if (!window.confirm(`Remove ${property.service_type} at ${property.service_address}? This will mark the service inactive and keep history.`)) return; state.properties = state.properties.map((p) => p.property_id === propertyId ? { ...p, status: 'inactive' } : p); saveState(state); flashMessage = 'Service removed from active work.'; render(); }));
  const batchForm = app.querySelector('#batch-form');
  if (batchForm) batchForm.addEventListener('submit', (event) => { event.preventDefault(); const formData = new FormData(batchForm); const summary = generateBatchInvoices(state, formData.get('start'), formData.get('end')); saveState(state); flashMessage = `Generated ${summary.createdCount} invoices from ${summary.billedVisitCount} completed visits.`; activeView = 'invoices'; selectedCustomerId = ''; showOverdueRoute = false; render(); });
  app.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => { const [invoiceId, status] = button.dataset.pay.split(':'); updateInvoicePaymentStatus(state, invoiceId, status); saveState(state); flashMessage = `Invoice ${invoiceId} marked as ${status}.`; render(); }));
  const routeDateInput = app.querySelector('#route-date');
  if (routeDateInput) routeDateInput.addEventListener('change', () => { selectedRouteDate = routeDateInput.value; showOverdueRoute = false; render(); });
  if (activeView === 'route-builder') {
    bindRouteBuilderEvents(state, saveState, (date) => { selectedRouteBuilderDate = date; }, render);
  }
  if (activeView === 'employees') {
    bindEmployeeEvents(render);
  }
  app.querySelectorAll('[data-worker-action]').forEach((button) => button.addEventListener('click', () => {
    const [visitId, action] = button.dataset.workerAction.split(':');
    updateWorkerVisitStatus(visitId, action);
    if (action === 'start') flashMessage = 'Stop started.';
    if (action === 'complete') flashMessage = 'Stop completed.';
    if (action === 'skip') flashMessage = 'Stop skipped.';
    render();
  }));
  const logoutButton = app.querySelector('[data-logout]');
  if (logoutButton) logoutButton.addEventListener('click', () => { clearSession(); currentSession = null; activeView = 'dashboard'; flashMessage = ''; render(); });
  const resetButton = app.querySelector('#reset-seed');
  if (resetButton) resetButton.addEventListener('click', () => { state = resetSeed(); selectedRouteDate = today(); selectedCustomerId = ''; selectedCustomerLetter = 'all'; selectedRouteBuilderDate = today(); showOverdueRoute = false; flashMessage = 'Seed data restored.'; render(); });
  app.querySelectorAll('[data-ledger]').forEach((button) => button.addEventListener('click', () => { flashMessage = `Ledger view for customer ${button.dataset.ledger} is available in the customer ledger workflow.`; render(); }));
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
render();
