import {
  computeDashboard,
  getCustomerMap,
  getPropertyMap,
  loadState,
  resetSeed
} from './lib/store.js';
import {
  getSession,
  clearSession,
  clearAuthenticatedSession,
  renderLogin,
  restoreProductionAppSession
} from './role-pin-login.js';
import { renderRouteBuilder, bindRouteBuilderEvents } from './route-builder.js';
import { renderEmployees, bindEmployeeEvents } from './employees.js';
import {
  generateInvoicesForDateRange,
  generateInvoicesForVisits
} from './services/billingService.js';
import { deactivateCustomerAndProperties } from './services/customerService.js';
import { updateInvoicePaymentStatus } from './services/paymentService.js';
import { completeVisit, skipVisit, startVisit } from './services/visitLifecycleService.js';
import {
  createCustomer,
  updateCustomer
} from './data/repositories/customerRepository.js';
import {
  createProperty,
  pausePropertyService,
  removePropertyService,
  updateProperty,
  updatePropertyFrequency,
  updatePropertyPrice
} from './data/repositories/propertyRepository.js';
import {
  bulkCreateVisits,
  scheduleOneOffVisit,
  scheduleVisit
} from './data/repositories/visitRepository.js';
import {
  canUseLocalPersistenceFallback,
  getAppMode,
  getAppModeRequirementMessage,
  getProductionModeRequirementMessage,
  isProductionMode
} from './data/appMode.js';
import { validateRepositoryAuthContext } from './data/repositoryContext.js';
import { syncFoundationFromSupabase } from './data/supabaseFoundation.js';
import {
  clearOperationalLogs,
  formatUserError,
  getOperationalLogs,
  logOperationalError,
  logOperationalEvent
} from './services/operationalLogger.js';
import {
  allowedNavItems,
  canAccessView,
  getDefaultView,
  getRestrictedViewReason,
  getUiPermissions
} from './services/uiPermissionService.js';
import { escapeAttr, escapeHtml } from './utils/renderSecurity.js';

const app = document.querySelector('#app');
let state = canUseLocalPersistenceFallback() ? loadState() : {};
let currentSession = canUseLocalPersistenceFallback() ? getSession() : null;
let activeView = ['employee', 'worker'].includes(String(currentSession?.role || '').toLowerCase()) ? 'worker-route' : 'dashboard';
let flashMessage = '';
let selectedRouteDate = new Date().toISOString().slice(0, 10);
let selectedRouteBuilderDate = new Date().toISOString().slice(0, 10);
let selectedCustomerId = '';
let selectedCustomerLetter = 'all';
let showOverdueRoute = false;
let billingSelectedVisitIds = new Set();
let billingDateFilter = 'all';
let billingSortOrder = 'newest';
let productionModeBlockedReason = '';
let productionAuthDiagnostics = null;

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

const WORKER_NAV_ITEMS = [['worker-route', 'My Route']];
const ADMIN_VIEWS = new Set([
  'dashboard',
  'today-route',
  'route-builder',
  'employees',
  'customers',
  'timeline',
  'properties',
  'visits',
  'batch',
  'invoices',
  'payments',
  'settings'
]);

function isWorkerSession(session) {
  return getUiPermissions(session).isEmployee;
}

function isAdminView(view) {
  return ADMIN_VIEWS.has(view);
}

function getNavItems(session) {
  return allowedNavItems(isWorkerSession(session) ? WORKER_NAV_ITEMS : ALL_NAV_ITEMS, session);
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

async function ensureRouteVisitsForDate(targetDate) {
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
  const createdVisits = await bulkCreateVisits(newVisits, {
    action: 'visit:create-route-date-generated',
    eventAction: 'route-date-generated'
  });
  if (createdVisits.length) state = loadState();
  return createdVisits.length;
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
  if (overdueVisit) return `<p><span class="badge overdue">⚠ Overdue since ${escapeHtml(overdueVisit.visit_date)}</span></p>`;
  const nextVisit = scheduledVisits.find((v) => v.visit_date >= currentDate);
  if (nextVisit) return `<p><span class="badge paid-up">Next visit: ${escapeHtml(nextVisit.visit_date)}</span></p>`;
  return '<p><span class="badge outstanding">Next visit: none scheduled</span></p>';
}

function renderOverdueVisitBanner(propertyMap, customerMap) {
  const overdueVisits = getOverdueScheduledVisits();
  if (!overdueVisits.length) return '';
  const firstVisit = overdueVisits[0];
  const property = propertyMap[firstVisit.property_id];
  const customer = customerMap[property?.customer_id];
  const plural = overdueVisits.length === 1 ? 'visit is' : 'visits are';
  const example = property ? ` Oldest: ${escapeHtml(customer?.name ?? 'Unknown customer')} · ${escapeHtml(property.service_address)} · ${escapeHtml(firstVisit.visit_date)}.` : '';
  return `<div class="flash overdue-alert">⚠ ${overdueVisits.length} scheduled ${plural} overdue.${example} <button class="primary" data-overdue-visits>View overdue visits</button></div>`;
}

function renderPropertyQuickActionCards(properties, customerMap) {
  const permissions = getUiPermissions(currentSession);
  if (!properties.length) return '<article class="panel"><p>No service locations found for this customer.</p></article>';
  return properties.map((p) => {
    const actions = [
      permissions.visits.create ? `<button data-service-schedule="${escapeAttr(p.property_id)}">Schedule Visit</button>` : '',
      permissions.properties.update ? `<button data-service-pause="${escapeAttr(p.property_id)}">Pause Service</button>` : '',
      permissions.properties.update ? `<button data-service-frequency="${escapeAttr(p.property_id)}">Change Frequency</button>` : '',
      permissions.properties.update ? `<button data-service-price="${escapeAttr(p.property_id)}">Adjust Price</button>` : ''
    ].filter(Boolean).join('');
    return `<article class="panel"><div class="customer-card-header"><div><h3>${escapeHtml(p.service_address)}</h3><p>${escapeHtml(customerMap[p.customer_id]?.name ?? 'Unknown Customer')}</p></div><span class="badge ${p.status === 'active' ? 'paid-up' : 'outstanding'}">${escapeHtml(p.status)}</span></div><p>${escapeHtml(p.service_type)} · ${escapeHtml(p.recurring_frequency)}</p>${renderVisitStatusLine(p.property_id)}<p>Default Price: ${currency(p.default_price)}</p><p>Notes: ${escapeHtml(p.notes || 'None')}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</article>`;
  }).join('');
}

async function render() {
  if (productionModeBlockedReason) {
    renderProductionModeBlocker(productionModeBlockedReason);
    return;
  }

  currentSession = getSession();
  if (isProductionMode() && currentSession && productionAuthDiagnostics?.ready) {
    currentSession = {
      ...currentSession,
      auth_user_id: productionAuthDiagnostics.userId || currentSession.auth_user_id || null,
      membership_id: productionAuthDiagnostics.membershipId || currentSession.membership_id || null,
      membership_role: productionAuthDiagnostics.role || currentSession.membership_role || null,
      company_id: productionAuthDiagnostics.companyId || currentSession.company_id || null,
      employee_id: productionAuthDiagnostics.employeeId || currentSession.employee_id || null
    };
  }
  if (!currentSession) {
    renderLogin();
    return;
  }

  if (!canAccessView(activeView, currentSession)) {
    activeView = getDefaultView(currentSession);
  }

  if (activeView === 'today-route' && !showOverdueRoute) {
    await ensureRouteVisitsForDate(selectedRouteDate);
  }

  const customerMap = getCustomerMap(state);
  const propertyMap = getPropertyMap(state);
  const metrics = computeDashboard(state);
  const companyName = state.company?.name?.trim() || 'ServiceBatch';
  const navItems = getNavItems(currentSession);
  const sessionBanner = renderSessionBanner(currentSession);
  const overdueBanner = isWorkerSession(currentSession) ? '' : renderOverdueVisitBanner(propertyMap, customerMap);

  app.innerHTML = `<div class="layout"><aside class="sidebar"><h1>${escapeHtml(companyName)}</h1><nav>${navItems.map(([id, label]) => `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${escapeAttr(id)}">${escapeHtml(label)}</button>`).join('')}</nav></aside><main class="content">${sessionBanner}${flashMessage ? `<div class="flash">${escapeHtml(flashMessage)}</div>` : ''}${overdueBanner}${renderView(activeView, metrics, customerMap, propertyMap)}</main><nav class="bottom-nav">${navItems.map(([id, label]) => `<button class="nav-btn ${activeView === id ? 'active' : ''}" data-nav="${escapeAttr(id)}">${escapeHtml(label)}</button>`).join('')}</nav></div>`;
  bindEvents();
}

function renderProductionModeBlocker(reason) {
  app.innerHTML = `
    <main class="content login-shell">
      <section class="panel login-card">
        <h1>FieldCore Production Mode</h1>
        <p>${escapeHtml(reason)}</p>
        <p>Current mode: ${escapeHtml(getAppMode())}</p>
      </section>
    </main>
  `;
}

function renderView(view, metrics, customerMap, propertyMap) {
  if (!canAccessView(view, currentSession)) return renderRestrictedView(view);
  if (isWorkerSession(currentSession) && isAdminView(view)) return renderWorkerRoute(currentSession);
  if (view === 'dashboard') return renderDashboard(metrics);
  if (view === 'worker-route') return renderWorkerRoute(currentSession);
  if (view === 'route-builder') return renderRouteBuilder(state, selectedRouteBuilderDate, getUiPermissions(currentSession));
  if (view === 'employees') return renderEmployees(getUiPermissions(currentSession));
  if (view === 'customers') return renderCustomers();
  if (view === 'timeline') return renderTimeline(customerMap, propertyMap);
  if (view === 'properties') return renderProperties(customerMap);
  if (view === 'visits') return renderTimeline(customerMap, propertyMap);
  if (view === 'today-route') return renderTodayRoute(customerMap, propertyMap);
  if (view === 'batch') return renderBatch(customerMap, propertyMap);
  if (view === 'invoices') return renderInvoices(customerMap);
  if (view === 'payments') return renderPayments(customerMap);
  return renderSettings();
}

function renderRestrictedView(view) {
  return `<section><h2>Access Restricted</h2><article class="panel"><p>${escapeHtml(getRestrictedViewReason(view, currentSession))}</p><button class="primary" data-nav="${escapeAttr(getDefaultView(currentSession))}">Return to allowed view</button></article></section>`;
}

function renderDashboard(metrics) {
  const permissions = getUiPermissions(currentSession);
  const billingPanel = permissions.financials.read ? `<section class="panel"><h3>Billing Queue</h3><div class="overview-cards">${metricCard('Ready-to-Bill Visits', metrics.readyToBillVisits)}${metricCard('Ready-to-Bill Amount', currency(metrics.readyToBillAmount))}</div></section>` : '';
  const financialPanel = permissions.financials.read ? `<section class="panel"><h3>Financial Snapshot</h3><div class="overview-cards">${metricCard('Total Outstanding', currency(metrics.totalOutstanding))}${metricCard('Overdue Amount', currency(metrics.overdueAmount))}${metricCard('Paid This Month', currency(metrics.paidThisMonth))}</div></section>` : '';
  return `<section><h2>Operations Dashboard</h2></section><section class="panel"><h3>Today’s Priorities</h3><ul><li>${metrics.todayScheduledVisits} visits scheduled</li>${permissions.financials.read ? `<li>${metrics.overdueInvoices} invoices overdue</li><li>${metrics.readyToBillVisits} visits ready to bill</li>` : ''}</ul></section><section class="panel"><h3>Today’s Visits</h3><div class="overview-cards">${metricCard('Today Scheduled Visits', metrics.todayScheduledVisits)}${metricCard('Today Completed Visits', metrics.todayCompletedVisits)}${metricCard('Today Skipped Visits', metrics.todaySkippedVisits)}</div></section>${billingPanel}${financialPanel}`;
}

function renderCustomers() {
  const permissions = getUiPermissions(currentSession);
  const customers = getFilteredCustomers();
  return `<section><h2>Customers</h2>${permissions.customers.create ? renderCustomerForm() : ''}${renderCustomerLetterFilter()}<div class="stack">${customers.length ? customers.map((c) => {
    const balance = getCustomerBalance(c.customer_id);
    const summary = getCustomerSummary(c.customer_id);
    const paidUp = balance.outstanding <= 0;
    const overdue = balance.overdue > 0;
    const actions = [
      permissions.customers.ledger ? `<button data-ledger="${escapeAttr(c.customer_id)}">View Ledger</button>` : '',
      permissions.properties.read ? `<button data-customer-nav="properties:${escapeAttr(c.customer_id)}">Manage Services</button>` : '',
      `<button data-customer-nav="timeline:${escapeAttr(c.customer_id)}">Customer Activity</button>`,
      permissions.customers.update ? `<button data-customer-edit="${escapeAttr(c.customer_id)}">Edit Customer</button>` : '',
      permissions.customers.deactivate ? `<button data-customer-remove="${escapeAttr(c.customer_id)}">Remove Customer</button>` : ''
    ].filter(Boolean).join('');
    return `<article class="panel customer-card"><div class="customer-card-header"><div><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.phone || 'No phone')} · ${escapeHtml(c.email || 'No email')}</p></div><span class="badge ${c.status === 'active' ? 'paid-up' : 'outstanding'}">${escapeHtml(c.status)}</span></div><p>${escapeHtml(c.billing_address || 'No billing address')}</p><div class="customer-overview"><div><span>Properties</span><strong>${summary.propertyCount}</strong></div><div><span>Active Services</span><strong>${summary.activeRecurringServices}</strong></div><div><span>Last Activity</span><strong>${escapeHtml(summary.lastVisitDate)}</strong></div></div><div class="balance-badges">${paidUp ? '<span class="badge paid-up">Paid up</span>' : `<span class="badge outstanding">Outstanding: ${currency(balance.outstanding)}</span>`}${overdue ? `<span class="badge overdue">Overdue: ${currency(balance.overdue)}</span>` : ''}</div><div class="actions">${actions}</div></article>`;
  }).join('') : '<article class="panel"><p>No customers found for this letter.</p></article>'}</div></section>`;
}

function renderTimeline(customerMap, propertyMap) {
  const permissions = getUiPermissions(currentSession);
  const customer = selectedCustomer();
  const properties = customer ? customerProperties(customer.customer_id) : [];
  const events = customer ? buildCustomerTimeline(customer.customer_id, customerMap, propertyMap) : [];
  const quickActions = customer ? `<div class="actions" style="margin: 0.75rem 0;">${[
    permissions.properties.create ? `<button data-customer-nav="properties:${escapeAttr(customer.customer_id)}">+ Add Service</button>` : '',
    permissions.visits.create ? `<button data-customer-nav="properties:${escapeAttr(customer.customer_id)}">+ Schedule Visit</button>` : '',
    permissions.financials.createInvoices ? '<button data-nav="batch">Create Invoice</button>' : '',
    permissions.financials.recordPayments ? '<button data-nav="payments">Record Payment</button>' : ''
  ].filter(Boolean).join('')}</div>` : '';
  const serviceLocationCards = customer ? `<h3>Service Locations</h3><div class="stack">${renderPropertyQuickActionCards(properties, customerMap)}</div>` : '';
  return `<section><h2>${customer ? `${escapeHtml(customer.name)} Customer Activity` : 'Customer Activity'}</h2><button class="primary" data-nav="customers">Back to Customers</button>${quickActions}${serviceLocationCards}<h3>Activity Timeline</h3><div class="stack timeline-stack">${events.length ? events.map((event) => `<article class="panel timeline-event"><div class="timeline-date">${escapeHtml(event.date)}</div><div><span class="badge outstanding">${escapeHtml(event.type)}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.detail)}</p></div></article>`).join('') : '<article class="panel"><p>No customer activity found yet.</p></article>'}</div></section>`;
}

function renderProperties(customerMap) {
  const permissions = getUiPermissions(currentSession);
  const customer = selectedCustomer();
  const properties = selectedCustomerId ? customerProperties(selectedCustomerId) : state.properties;
  const serviceForms = customer && (permissions.properties.create || permissions.visits.create) ? `<div class="service-layout">${permissions.properties.create ? `<form id="service-form" class="panel service-form"><h3>Add Recurring Service or Service Location</h3><label>Service Location<input name="service_address" placeholder="123 Main St or Backyard" required /></label><label>Service Type<input name="service_type" placeholder="Mowing, Garden Care, Snow Removal" required /></label><label>Frequency<select name="recurring_frequency" required><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="one-time">One-time / odd job location</option></select></label><label>Default Price<input name="default_price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Gate code, preferred day, service notes" /></label><button class="primary" type="submit">Add Service</button></form>` : ''}${permissions.visits.create ? `<form id="one-off-form" class="panel service-form"><h3>Schedule One-Off Job</h3>${properties.length ? `<label>Service Location<select name="property_id" required>${properties.map((p) => `<option value="${escapeAttr(p.property_id)}">${escapeHtml(p.service_address)}</option>`).join('')}</select></label>` : '<p>Add a service location before scheduling a one-off job.</p>'}<label>Job Date<input name="visit_date" type="date" required /></label><label>Job Description<input name="service_description" placeholder="Mulch install, weeding, cleanup" required /></label><label>Price<input name="price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Materials, access notes, special instructions" /></label><button class="primary" type="submit" ${properties.length ? '' : 'disabled'}>Schedule One-Off Job</button></form>` : ''}</div>` : '';
  return `<section><h2>${customer ? `${escapeHtml(customer.name)} Services / Service Locations` : 'Properties / Service Locations'}</h2>${customer ? '<button class="primary" data-nav="customers">Back to Customers</button>' : ''}${serviceForms}<div class="stack">${properties.length ? properties.map((p) => {
    const actions = customer ? [
      permissions.properties.update ? `<button data-service-edit="${escapeAttr(p.property_id)}">Change Service</button>` : '',
      permissions.properties.deactivate ? `<button data-service-remove="${escapeAttr(p.property_id)}">Remove Service</button>` : ''
    ].filter(Boolean).join('') : '';
    return `<article class="panel"><div class="customer-card-header"><div><h3>${escapeHtml(p.service_address)}</h3><p>${escapeHtml(customerMap[p.customer_id]?.name ?? 'Unknown Customer')}</p></div><span class="badge ${p.status === 'active' ? 'paid-up' : 'outstanding'}">${escapeHtml(p.status)}</span></div><p>${escapeHtml(p.service_type)} · ${escapeHtml(p.recurring_frequency)}</p>${renderVisitStatusLine(p.property_id)}<p>Default Price: ${currency(p.default_price)}</p><p>Notes: ${escapeHtml(p.notes || 'None')}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</article>`;
  }).join('') : '<article class="panel"><p>No properties found for this customer.</p></article>'}</div></section>`;
}

function renderTodayRoute(customerMap, propertyMap) {
  const permissions = getUiPermissions(currentSession);
  const routeVisits = showOverdueRoute ? getOverdueScheduledVisits() : state.visits.filter((v) => v.visit_date === selectedRouteDate);
  const heading = showOverdueRoute ? 'Overdue Visits' : 'Today’s Route / Daily Work List';
  const emptyText = showOverdueRoute ? 'No overdue visits found.' : 'No visits found for this date.';
  const dateControl = showOverdueRoute
    ? '<div class="panel"><p>Showing scheduled visits older than today.</p><button data-clear-overdue-route>Back to selected date</button></div>'
    : `<div class="panel"><label>Select Date<input type="date" id="route-date" value="${selectedRouteDate}" /></label></div>`;
  return `<section><h2>${escapeHtml(heading)}</h2>${dateControl}<div class="stack">${routeVisits.length ? routeVisits.map((v) => { const property = propertyMap[v.property_id]; const customer = customerMap[property?.customer_id]; const actions = permissions.visits.updateCompanyWide ? `<div class="actions"><button data-visit-action="${escapeAttr(v.visit_id)}:complete">Mark Completed</button><button data-visit-action="${escapeAttr(v.visit_id)}:skip">Mark Skipped</button><button data-visit-action="${escapeAttr(v.visit_id)}:skip-reschedule">Skip + Reschedule</button></div>` : ''; return `<article class="panel"><h3>${escapeHtml(customer?.name ?? 'Unknown Customer')}</h3><p>${escapeHtml(property?.service_address ?? 'Unknown address')}</p><p>${escapeHtml(v.service_description)}</p><p>${escapeHtml(property?.service_type ?? 'Service')} · ${escapeHtml(property?.recurring_frequency ?? 'n/a')}</p><p>Visit date ${escapeHtml(v.visit_date)}</p><p>Price ${currency(v.price)}</p><p>Notes: ${escapeHtml(v.notes || 'None')}</p><p>Status: ${escapeHtml(v.status)}</p>${actions}</article>`; }).join('') : `<article class="panel"><p>${escapeHtml(emptyText)}</p></article>`}</div></section>`;
}

function renderSessionBanner(session) {
  return `
    <div class="flash session-banner">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
        <div><strong>${escapeHtml(session.name)}</strong> <span style="color:#475569;font-size:0.95rem;">(${escapeHtml(session.role)})</span></div>
        <button data-logout class="primary">Logout</button>
      </div>
    </div>
  `;
}

function renderWorkerStop(visit, customers, properties, index) {
  const permissions = getUiPermissions(currentSession);
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const serviceText = visit.service_description || property?.service_type || 'Service';
  const statusLabel = visit.status === 'in-progress' ? 'In progress' : visit.status === 'completed' ? 'Completed' : visit.status === 'skipped' ? 'Skipped' : 'Scheduled';
  const statusClass = visit.status === 'completed' ? 'completed' : visit.status === 'skipped' ? 'skipped' : visit.status === 'in-progress' ? 'current' : '';
  const actions = [];

  if (permissions.visits.updateAssignedLifecycle && visit.status === 'scheduled') {
    actions.push(`<button type="button" data-worker-action="${escapeAttr(visit.visit_id)}:start">Start Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${escapeAttr(visit.visit_id)}:complete">Complete Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${escapeAttr(visit.visit_id)}:skip">Skip Stop</button>`);
  } else if (permissions.visits.updateAssignedLifecycle && visit.status === 'in-progress') {
    actions.push(`<button type="button" data-worker-action="${escapeAttr(visit.visit_id)}:complete">Complete Stop</button>`);
    actions.push(`<button type="button" data-worker-action="${escapeAttr(visit.visit_id)}:skip">Skip Stop</button>`);
  }

  return `
    <article class="panel route-flow-stop ${statusClass}">
      <div class="route-stop-index">
        <p class="route-stop-kicker">Stop ${index + 1}</p>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
      <div class="route-stop-main-detail">
        <h3>${escapeHtml(customer?.name || 'Unknown Customer')}</h3>
        <p class="route-stop-address">${escapeHtml(property?.service_address || 'Unknown address')}</p>
        <p class="route-stop-service">${escapeHtml(serviceText)}</p>
        <p>${escapeHtml(property?.service_type || 'Service')} · ${escapeHtml(property?.recurring_frequency || 'n/a')}</p>
        <p>${escapeHtml(visit.notes || 'No notes provided.')}</p>
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
  const assignedRouteIds = new Set((state.routes || [])
    .filter((route) => route.route_date === todayDate && route.employee_id === session.employee_id)
    .map((route) => route.route_id));
  const assignedRouteVisitIds = new Set((state.routes || [])
    .filter((route) => route.route_date === todayDate && route.employee_id === session.employee_id)
    .flatMap((route) => route.visit_ids || []));
  const assignedVisits = state.visits.filter((visit) => {
    if (visit.visit_date !== todayDate) return false;
    if (isProductionMode()) {
      return assignedRouteIds.has(visit.route_id) || assignedRouteVisitIds.has(visit.visit_id);
    }
    return visit.assigned_worker === session.name;
  });
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

async function updateWorkerVisitStatus(visitId, action) {
  if (action === 'start') await startVisit(visitId, { source: 'worker-route' });
  if (action === 'complete') await completeVisit(visitId, { source: 'worker-route' });
  if (action === 'skip') await skipVisit(visitId, { source: 'worker-route' });
  state = loadState();
}

function getReadyToBillVisits() {
  return state.visits
    .filter((visit) => visit.status === 'completed')
    .sort((a, b) => compareReadyToBillDates(a, b, billingSortOrder));
}

function getReadyToBillDate(visit) {
  return visit.completed_at?.slice(0, 10) || visit.visit_date || '';
}

function dateFromIso(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shiftDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getBillingDateRange(filter) {
  const current = dateFromIso(today());
  if (!current || filter === 'all') return null;

  if (filter === 'today') {
    const todayDate = toIsoDate(current);
    return { start: todayDate, end: todayDate };
  }

  if (filter === 'week') {
    const start = shiftDate(current, -current.getDay());
    const end = shiftDate(start, 6);
    return { start: toIsoDate(start), end: toIsoDate(end) };
  }

  if (filter === 'month') {
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    return { start: toIsoDate(start), end: toIsoDate(end) };
  }

  return null;
}

function filterReadyToBillVisits(visits, filter) {
  const range = getBillingDateRange(filter);
  if (!range) return visits;
  return visits.filter((visit) => {
    const billableDate = getReadyToBillDate(visit);
    return billableDate >= range.start && billableDate <= range.end;
  });
}

function compareReadyToBillDates(a, b, sortOrder) {
  const aDate = getReadyToBillDate(a);
  const bDate = getReadyToBillDate(b);
  const direction = sortOrder === 'oldest' ? 1 : -1;

  if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate) * direction;
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return String(a.visit_id || '').localeCompare(String(b.visit_id || '')) * direction;
}

function renderBillingFilterButton(filter, label) {
  return `<button type="button" class="${billingDateFilter === filter ? 'active' : ''}" data-billing-filter="${filter}">${label}</button>`;
}

function getBillableVisitIds(visits, propertyMap) {
  return visits
    .filter((visit) => propertyMap[visit.property_id]?.customer_id)
    .map((visit) => visit.visit_id);
}

function trimBillingSelection(visits, propertyMap) {
  const billableIds = new Set(getBillableVisitIds(visits, propertyMap));
  billingSelectedVisitIds = new Set([...billingSelectedVisitIds].filter((visitId) => billableIds.has(visitId)));
}

function renderBillingQueueRow(visit, customerMap, propertyMap) {
  const property = propertyMap[visit.property_id];
  const customer = customerMap[property?.customer_id];
  const canInvoice = Boolean(customer);
  const isSelected = billingSelectedVisitIds.has(visit.visit_id);

  return `
    <article class="ready-bill-row ${isSelected ? 'selected' : ''}">
      <label class="ready-bill-check">
        <input type="checkbox" data-billing-visit="${escapeAttr(visit.visit_id)}" ${isSelected ? 'checked' : ''} ${canInvoice ? '' : 'disabled'} />
        <span>${canInvoice ? 'Select visit' : 'Missing customer'}</span>
      </label>
      <div class="ready-bill-main">
        <div>
          <strong>${escapeHtml(customer?.name || 'Unknown Customer')}</strong>
          <p>${escapeHtml(property?.service_address || 'Unknown service location')}</p>
        </div>
        <span class="badge ${canInvoice ? 'paid-up' : 'overdue'}">${canInvoice ? 'ready' : 'needs setup'}</span>
      </div>
      <div class="ready-bill-detail">
        <span>${escapeHtml(visit.visit_date || 'No date')}</span>
        <span>${escapeHtml(visit.service_description || property?.service_type || 'Service visit')}</span>
        <strong>${currency(visit.price)}</strong>
      </div>
    </article>
  `;
}

function renderBatch(customerMap, propertyMap) {
  const visits = getReadyToBillVisits();
  trimBillingSelection(visits, propertyMap);
  const visibleVisits = filterReadyToBillVisits(visits, billingDateFilter);
  const visibleBillableVisitIds = getBillableVisitIds(visibleVisits, propertyMap);
  const selectedVisits = visits.filter((visit) => billingSelectedVisitIds.has(visit.visit_id));
  const selectedSubtotal = selectedVisits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  const selectedTax = Number((selectedSubtotal * (state.settings.tax_rate ?? 0)).toFixed(2));
  const selectedInvoiceTotal = Number((selectedSubtotal + selectedTax).toFixed(2));
  const filterRange = getBillingDateRange(billingDateFilter);
  const filterSummary = filterRange
    ? `Showing service dates ${filterRange.start} to ${filterRange.end}.`
    : 'Showing all service dates.';

  return `
    <section class="ready-bill-queue" data-ready-bill-queue>
      <div class="page-header-v1">
        <div>
          <h2>Billing Queue</h2>
          <p>Review completed, uninvoiced visits one by one, then choose the work that should become draft customer invoices.</p>
        </div>
      </div>

      <div class="invoice-summary-grid ready-bill-summary">
        <article class="route-stat"><span>Ready visits</span><strong>${visibleBillableVisitIds.length}</strong></article>
        <article class="route-stat"><span>Selected visits</span><strong>${selectedVisits.length}</strong></article>
        <article class="route-stat"><span>Selected amount</span><strong>${currency(selectedSubtotal)}</strong></article>
        <article class="route-stat"><span>Estimated invoice total</span><strong>${currency(selectedInvoiceTotal)}</strong></article>
      </div>

      <div class="panel ready-bill-controls">
        <div>
          <p class="eyebrow">Filter service date</p>
          <div class="ready-bill-filter-buttons">
            ${renderBillingFilterButton('today', 'Today')}
            ${renderBillingFilterButton('week', 'This Week')}
            ${renderBillingFilterButton('month', 'This Month')}
            ${renderBillingFilterButton('all', 'All')}
          </div>
        </div>
        <label class="ready-bill-sort">
          <span>Sort</span>
          <select data-billing-sort>
            <option value="newest" ${billingSortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
            <option value="oldest" ${billingSortOrder === 'oldest' ? 'selected' : ''}>Oldest First</option>
          </select>
        </label>
      </div>

      <div class="panel ready-bill-toolbar">
        <div>
          <p class="eyebrow">Owner review</p>
          <h3>Completed visits</h3>
          <p>${visibleVisits.length ? `${visibleVisits.length} of ${visits.length} completed visit${visits.length === 1 ? '' : 's'} shown. ${filterSummary}` : `No completed visits match this filter. ${filterSummary}`}</p>
        </div>
        <div class="actions ready-bill-actions">
          <button type="button" data-billing-select-all ${visibleBillableVisitIds.length ? '' : 'disabled'}>Select All</button>
          <button type="button" data-billing-clear-all ${selectedVisits.length ? '' : 'disabled'}>Clear All</button>
          <button type="button" class="primary" data-billing-generate ${selectedVisits.length ? '' : 'disabled'}>Generate Invoices</button>
        </div>
      </div>

      <div class="ready-bill-list">
        ${visibleVisits.length ? visibleVisits.map((visit) => renderBillingQueueRow(visit, customerMap, propertyMap)).join('') : '<article class="panel"><p>No completed visits match this filter.</p></article>'}
      </div>
    </section>
  `;
}

function renderInvoices(customerMap) {
  return `<section><h2>Invoices</h2><div class="stack">${state.invoices.map((i) => `<article class="panel"><h3>${escapeHtml(i.invoice_number)}</h3><p>${escapeHtml(customerMap[i.customer_id]?.name ?? i.customer_name)}</p><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p><p>Status: ${escapeHtml(i.payment_status)} · Due ${escapeHtml(i.due_date)}</p></article>`).join('')}</div></section>`;
}

function renderPayments(customerMap) {
  const permissions = getUiPermissions(currentSession);
  const invoices = state.invoices.filter((i) => i.payment_status !== 'paid');
  const overdue = invoices.filter((i) => i.payment_status === 'overdue');
  return `<section><h2>Payments / Outstanding Tracking</h2><p>Outstanding Balance: <strong>${currency(computeDashboard(state).totalOutstanding)}</strong></p><h3>Unpaid Invoices</h3><div class="stack">${invoices.map((i) => `<article class="panel"><h4>${escapeHtml(i.invoice_number)} · ${escapeHtml(customerMap[i.customer_id]?.name ?? i.customer_name)}</h4><p>Total ${currency(i.total)} · Paid ${currency(i.amount_paid || 0)}</p>${permissions.financials.recordPayments ? `<div class="actions"><button data-pay="${escapeAttr(i.invoice_id)}:partial">Mark Partial</button><button data-pay="${escapeAttr(i.invoice_id)}:paid">Mark Paid</button></div>` : ''}</article>`).join('')}</div><h3>Overdue Invoices</h3><ul>${overdue.map((i) => `<li>${escapeHtml(i.invoice_number)} - ${currency(i.total - (i.amount_paid || 0))}</li>`).join('')}</ul></section>`;
}

function renderSettings() {
  const permissions = getUiPermissions(currentSession);
  return `<section><h2>Settings</h2><article class="panel"><p>Company: ${escapeHtml(state.company.name)}</p><p>Company ID: ${escapeHtml(state.company.company_id)}</p><p>Invoice Prefix: ${escapeHtml(state.settings.invoice_prefix)}</p><p>Tax Rate: ${(state.settings.tax_rate * 100).toFixed(1)}%</p>${permissions.settings.resetDemoData ? '<button id="reset-seed">Reset Demo Data</button>' : ''}${renderOperationalLogPanel()}</article></section>`;
}

function renderOperationalLogPanel() {
  const permissions = getUiPermissions(currentSession);
  if (!permissions.settings.operationalDiagnostics) return '';
  const logs = getOperationalLogs().slice(-20).reverse();
  return `
    <hr />
    <h3>Operational Diagnostics</h3>
    <p>Recent application events for support review.</p>
    <div class="stack">
      ${logs.length ? logs.map((entry) => `
        <article class="operational-log-entry">
          <div class="customer-card-header">
            <div>
              <h4>${escapeHtml(entry.severity)} · ${escapeHtml(entry.category)} · ${escapeHtml(entry.action)}</h4>
              <p>${escapeHtml(entry.timestamp)}</p>
            </div>
          </div>
          <p>${escapeHtml(entry.userMessage || entry.message)}</p>
          <p><small>${escapeHtml(entry.error?.message || entry.message)}</small></p>
        </article>
      `).join('') : '<article class="operational-log-entry"><p>No operational events recorded yet.</p></article>'}
    </div>
    ${permissions.settings.write ? '<button type="button" data-clear-operational-logs>Clear Diagnostics</button>' : ''}
  `;
}

function metricCard(label, value) {
  return `<article class="card"><p>${label}</p><strong>${value}</strong></article>`;
}

function reloadStateAndRender() {
  state = loadState();
  render();
}

function denyUiAction(message = 'You do not have permission for that action.') {
  logOperationalEvent({
    category: 'authorization',
    severity: 'warning',
    action: 'ui-permission-denied',
    message,
    userMessage: message,
    details: {
      activeView,
      role: getUiPermissions(currentSession).role,
      session: currentSession
    }
  });
  flashMessage = message;
  render();
  return false;
}

function showOperationError(error) {
  const userMessage = formatUserError(error);
  logOperationalError('repository', 'ui-operation-failed', error, {
    activeView,
    role: getUiPermissions(currentSession).role
  }, userMessage);
  flashMessage = userMessage;
  render();
}

function bindEvents() {
  app.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => {
    const nextView = button.dataset.nav;
    if (!canAccessView(nextView, currentSession)) {
      activeView = getDefaultView(currentSession);
      selectedCustomerId = '';
      showOverdueRoute = false;
      flashMessage = getRestrictedViewReason(nextView, currentSession);
      render();
      return;
    }
    activeView = nextView;
    selectedCustomerId = '';
    showOverdueRoute = false;
    flashMessage = '';
    render();
  }));
  app.querySelectorAll('[data-overdue-visits]').forEach((button) => button.addEventListener('click', () => { activeView = 'today-route'; selectedCustomerId = ''; showOverdueRoute = true; flashMessage = 'Showing overdue visits.'; render(); }));
  app.querySelectorAll('[data-clear-overdue-route]').forEach((button) => button.addEventListener('click', () => { showOverdueRoute = false; flashMessage = ''; render(); }));
  app.querySelectorAll('[data-letter-filter]').forEach((button) => button.addEventListener('click', () => { selectedCustomerLetter = button.dataset.letterFilter; render(); }));
  app.querySelectorAll('[data-customer-nav]').forEach((button) => button.addEventListener('click', () => {
    const [view, customerId] = button.dataset.customerNav.split(':');
    if (!canAccessView(view, currentSession)) {
      activeView = getDefaultView(currentSession);
      selectedCustomerId = '';
      showOverdueRoute = false;
      flashMessage = getRestrictedViewReason(view, currentSession);
      render();
      return;
    }
    activeView = view;
    selectedCustomerId = customerId;
    showOverdueRoute = false;
    flashMessage = '';
    render();
  }));
  const customerForm = app.querySelector('#customer-form');
  if (customerForm) customerForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!getUiPermissions(currentSession).customers.create) return denyUiAction(); const formData = new FormData(customerForm); const name = String(formData.get('name') || '').trim(); if (!name) return; await createCustomer({ name, phone: formData.get('phone') || '', email: formData.get('email') || '', billing_address: formData.get('billing_address') || '', preferred_service_day: formData.get('preferred_service_day') || undefined, status: 'active' }); selectedCustomerLetter = 'all'; state = loadState(); flashMessage = 'Customer added.'; render(); });
  app.querySelectorAll('[data-customer-edit]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).customers.update) return denyUiAction(); const customerId = button.dataset.customerEdit; const customer = state.customers.find((c) => c.customer_id === customerId); if (!customer) return; const name = window.prompt('Customer name:', customer.name); if (!name) return; const phone = window.prompt('Phone:', customer.phone || ''); if (phone === null) return; const email = window.prompt('Email:', customer.email || ''); if (email === null) return; const billingAddress = window.prompt('Billing address:', customer.billing_address || ''); if (billingAddress === null) return; const status = window.prompt('Status (active or inactive):', customer.status || 'active'); if (!status) return; await updateCustomer(customerId, { name, phone, email, billing_address: billingAddress, status }); state = loadState(); flashMessage = 'Customer updated.'; render(); }));
  app.querySelectorAll('[data-customer-remove]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).customers.deactivate) return denyUiAction(); const customerId = button.dataset.customerRemove; const customer = state.customers.find((c) => c.customer_id === customerId); if (!customer) return; if (!window.confirm(`Remove ${customer.name}? This will mark the customer inactive and keep history.`)) return; await deactivateCustomerAndProperties(customerId); state = loadState(); flashMessage = 'Customer removed from active work.'; render(); }));
  const serviceForm = app.querySelector('#service-form');
  if (serviceForm && selectedCustomerId) serviceForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!getUiPermissions(currentSession).properties.create) return denyUiAction(); const formData = new FormData(serviceForm); await createProperty({ customer_id: selectedCustomerId, service_address: formData.get('service_address'), service_type: formData.get('service_type'), recurring_frequency: formData.get('recurring_frequency'), default_price: Number(formData.get('default_price') || 0), status: 'active', notes: formData.get('notes') || '' }); state = loadState(); flashMessage = 'Service added.'; render(); });
  const oneOffForm = app.querySelector('#one-off-form');
  if (oneOffForm && selectedCustomerId) oneOffForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!getUiPermissions(currentSession).visits.create) return denyUiAction(); const formData = new FormData(oneOffForm); await scheduleOneOffVisit({ company_id: state.company.company_id, property_id: formData.get('property_id'), visit_date: formData.get('visit_date'), service_description: formData.get('service_description'), price: Number(formData.get('price') || 0), status: 'scheduled', notes: formData.get('notes') || 'One-off job' }); state = loadState(); flashMessage = 'One-off job scheduled.'; render(); });
  app.querySelectorAll('[data-service-schedule]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).visits.create) return denyUiAction(); const propertyId = button.dataset.serviceSchedule; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const visitDate = window.prompt('Schedule visit date (YYYY-MM-DD):', today()); if (!visitDate) return; const description = window.prompt('Visit description:', `${property.service_type} service`); if (!description) return; const price = window.prompt('Visit price:', property.default_price); if (price === null) return; const notes = window.prompt('Visit notes:', property.notes || ''); if (notes === null) return; await scheduleVisit({ company_id: state.company.company_id, property_id: property.property_id, visit_date: visitDate, service_description: description, price: Number(price || 0), status: 'scheduled', notes }); state = loadState(); flashMessage = `Visit scheduled for ${visitDate}.`; render(); }));
  app.querySelectorAll('[data-service-pause]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).properties.update) return denyUiAction(); const propertyId = button.dataset.servicePause; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; if (!window.confirm(`Pause service at ${property.service_address}?`)) return; await pausePropertyService(propertyId); state = loadState(); flashMessage = 'Service paused.'; render(); }));
  app.querySelectorAll('[data-service-frequency]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).properties.update) return denyUiAction(); const propertyId = button.dataset.serviceFrequency; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const frequency = window.prompt('Frequency (weekly, biweekly, monthly, one-time):', property.recurring_frequency); if (!frequency) return; await updatePropertyFrequency(propertyId, frequency); state = loadState(); flashMessage = 'Service frequency updated.'; render(); }));
  app.querySelectorAll('[data-service-price]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).properties.update) return denyUiAction(); const propertyId = button.dataset.servicePrice; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const price = window.prompt('Default price:', property.default_price); if (price === null) return; await updatePropertyPrice(propertyId, Number(price || 0)); state = loadState(); flashMessage = 'Service price updated.'; render(); }));
  app.querySelectorAll('[data-service-edit]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).properties.update) return denyUiAction(); const propertyId = button.dataset.serviceEdit; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; const serviceType = window.prompt('Service type:', property.service_type); if (!serviceType) return; const frequency = window.prompt('Frequency (weekly, biweekly, monthly, one-time):', property.recurring_frequency); if (!frequency) return; const price = window.prompt('Default price:', property.default_price); if (price === null) return; const notes = window.prompt('Notes:', property.notes || ''); if (notes === null) return; const status = window.prompt('Status (active or inactive):', property.status || 'active'); if (!status) return; await updateProperty(propertyId, { service_type: serviceType, recurring_frequency: frequency, default_price: Number(price || 0), notes, status }); state = loadState(); flashMessage = 'Service updated.'; render(); }));
  app.querySelectorAll('[data-service-remove]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).properties.deactivate) return denyUiAction(); const propertyId = button.dataset.serviceRemove; const property = state.properties.find((p) => p.property_id === propertyId); if (!property) return; if (!window.confirm(`Remove ${property.service_type} at ${property.service_address}? This will mark the service inactive and keep history.`)) return; await removePropertyService(propertyId); state = loadState(); flashMessage = 'Service removed from active work.'; render(); }));
  const batchForm = app.querySelector('#batch-form');
  if (batchForm) batchForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!getUiPermissions(currentSession).financials.createInvoices) return denyUiAction(); const formData = new FormData(batchForm); const summary = await generateInvoicesForDateRange(formData.get('start'), formData.get('end'), { source: 'batch-form' }); state = loadState(); flashMessage = `Generated ${summary.createdCount} invoices from ${summary.billedVisitCount} completed visits.`; activeView = 'invoices'; selectedCustomerId = ''; showOverdueRoute = false; render(); });
  app.querySelectorAll('[data-billing-visit]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    if (checkbox.checked) billingSelectedVisitIds.add(checkbox.dataset.billingVisit);
    else billingSelectedVisitIds.delete(checkbox.dataset.billingVisit);
    render();
  }));
  app.querySelectorAll('[data-billing-filter]').forEach((button) => button.addEventListener('click', () => {
    billingDateFilter = button.dataset.billingFilter || 'all';
    render();
  }));
  const billingSort = app.querySelector('[data-billing-sort]');
  if (billingSort) billingSort.addEventListener('change', () => {
    billingSortOrder = billingSort.value === 'oldest' ? 'oldest' : 'newest';
    render();
  });
  const billingSelectAll = app.querySelector('[data-billing-select-all]');
  if (billingSelectAll) billingSelectAll.addEventListener('click', () => {
    if (!getUiPermissions(currentSession).financials.createInvoices) return denyUiAction();
    const propertyMap = getPropertyMap(state);
    const visibleVisits = filterReadyToBillVisits(getReadyToBillVisits(), billingDateFilter);
    getBillableVisitIds(visibleVisits, propertyMap).forEach((visitId) => billingSelectedVisitIds.add(visitId));
    render();
  });
  const billingClearAll = app.querySelector('[data-billing-clear-all]');
  if (billingClearAll) billingClearAll.addEventListener('click', () => {
    if (!getUiPermissions(currentSession).financials.createInvoices) return denyUiAction();
    billingSelectedVisitIds = new Set();
    render();
  });
  const billingGenerate = app.querySelector('[data-billing-generate]');
  if (billingGenerate) billingGenerate.addEventListener('click', async () => {
    if (!getUiPermissions(currentSession).financials.createInvoices) return denyUiAction();
    const summary = await generateInvoicesForVisits([...billingSelectedVisitIds], { source: 'ready-to-bill' });
    billingSelectedVisitIds = new Set();
    state = loadState();
    flashMessage = `Generated ${summary.createdCount} invoices from ${summary.billedVisitCount} selected visits.`;
    activeView = 'invoices';
    selectedCustomerId = '';
    showOverdueRoute = false;
    render();
  });
  app.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', async () => { if (!getUiPermissions(currentSession).financials.recordPayments) return denyUiAction(); const [invoiceId, status] = button.dataset.pay.split(':'); await updateInvoicePaymentStatus(invoiceId, status, { source: 'payments-view' }); state = loadState(); flashMessage = `Invoice ${invoiceId} marked as ${status}.`; render(); }));
  const routeDateInput = app.querySelector('#route-date');
  if (routeDateInput) routeDateInput.addEventListener('change', () => { selectedRouteDate = routeDateInput.value; showOverdueRoute = false; render(); });
  if (activeView === 'route-builder') {
    bindRouteBuilderEvents(state, (date) => { selectedRouteBuilderDate = date; }, render, getUiPermissions(currentSession));
  }
  if (activeView === 'employees') {
    bindEmployeeEvents(reloadStateAndRender, getUiPermissions(currentSession));
  }
  app.querySelectorAll('[data-worker-action]').forEach((button) => button.addEventListener('click', async () => {
    if (!getUiPermissions(currentSession).visits.updateAssignedLifecycle) return denyUiAction();
    const [visitId, action] = button.dataset.workerAction.split(':');
    await updateWorkerVisitStatus(visitId, action);
    if (action === 'start') flashMessage = 'Stop started.';
    if (action === 'complete') flashMessage = 'Stop completed.';
    if (action === 'skip') flashMessage = 'Stop skipped.';
    render();
  }));
  const logoutButton = app.querySelector('[data-logout]');
  if (logoutButton) logoutButton.addEventListener('click', async () => {
    await clearAuthenticatedSession();
    currentSession = null;
    activeView = 'dashboard';
    selectedCustomerId = '';
    selectedCustomerLetter = 'all';
    showOverdueRoute = false;
    flashMessage = '';
    render();
  });
  const resetButton = app.querySelector('#reset-seed');
  if (resetButton) resetButton.addEventListener('click', () => { if (!getUiPermissions(currentSession).settings.resetDemoData) return denyUiAction(); state = resetSeed(); selectedRouteDate = today(); selectedCustomerId = ''; selectedCustomerLetter = 'all'; selectedRouteBuilderDate = today(); showOverdueRoute = false; flashMessage = 'Seed data restored.'; render(); });
  const clearLogsButton = app.querySelector('[data-clear-operational-logs]');
  if (clearLogsButton) clearLogsButton.addEventListener('click', () => { if (!getUiPermissions(currentSession).settings.write) return denyUiAction(); clearOperationalLogs(); flashMessage = 'Operational diagnostics cleared.'; render(); });
  app.querySelectorAll('[data-ledger]').forEach((button) => button.addEventListener('click', () => { if (!getUiPermissions(currentSession).customers.ledger) return denyUiAction(); flashMessage = `Ledger view for customer ${button.dataset.ledger} is available in the customer ledger workflow.`; render(); }));
}

async function initializeApp() {
  logOperationalEvent({
    category: 'startup',
    severity: 'info',
    action: 'app-initialize-start',
    message: 'Application startup began.',
    details: { mode: getAppMode() }
  });

  const modeRequirementMessage = getAppModeRequirementMessage();
  if (modeRequirementMessage) {
    logOperationalEvent({
      category: 'startup',
      severity: 'critical',
      action: 'app-mode-invalid',
      message: modeRequirementMessage,
      userMessage: modeRequirementMessage,
      details: { mode: getAppMode() }
    });
    productionModeBlockedReason = modeRequirementMessage;
    await render();
    return;
  }

  if (isProductionMode()) {
    const diagnostics = await validateRepositoryAuthContext();
    productionAuthDiagnostics = diagnostics;
    const requirementMessage = getProductionModeRequirementMessage({
      ...diagnostics,
      supabaseConfigured: Boolean(diagnostics.transport?.configured)
    });

    if (!diagnostics.transport?.configured) {
      logOperationalEvent({
        category: 'startup',
        severity: 'critical',
        action: 'production-unconfigured',
        message: requirementMessage,
        userMessage: requirementMessage,
        details: diagnostics
      });
      productionModeBlockedReason = requirementMessage;
      await render();
      return;
    }

    if (!diagnostics.ready) {
      logOperationalEvent({
        category: 'membership',
        severity: 'warning',
        action: 'production-auth-context-not-ready',
        message: requirementMessage || 'Production auth context is not ready.',
        userMessage: requirementMessage || 'Your company access could not be verified.',
        details: diagnostics
      });
      clearSession();
      currentSession = null;
      productionModeBlockedReason = '';
      await renderLogin();
      return;
    }

    if (!getSession()) {
      await restoreProductionAppSession(diagnostics);
    }
  }

  try {
    const syncSummary = await syncFoundationFromSupabase();
    logOperationalEvent({
      category: 'synchronization',
      severity: 'info',
      action: 'startup-sync-success',
      message: 'Startup synchronization completed.',
      details: syncSummary
    });
  } catch (error) {
    if (isProductionMode()) {
      const userMessage = 'Production data could not be loaded. Please contact support.';
      logOperationalError('startup', 'startup-sync-failed', error, {}, userMessage);
      productionModeBlockedReason = userMessage;
      await render();
      return;
    }
  }
  state = loadState();
  currentSession = getSession();
  logOperationalEvent({
    category: 'startup',
    severity: 'info',
    action: 'app-initialize-complete',
    message: 'Application startup completed.',
    details: { activeView, hasSession: Boolean(currentSession) }
  });
  await render();
}

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  showOperationError(event.reason);
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
initializeApp();
