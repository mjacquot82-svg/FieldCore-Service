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

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function customerMap(state) {
  return Object.fromEntries((state.customers || []).map((customer) => [customer.customer_id, customer]));
}

function propertyMap(state) {
  return Object.fromEntries((state.properties || []).map((property) => [property.property_id, property]));
}

function getSelectedRouteDate() {
  return document.querySelector('#route-date')?.value || new Date().toISOString().slice(0, 10);
}

function visitIsInvoiced(visit, state) {
  return (state.invoices || []).some((invoice) =>
    Array.isArray(invoice.visit_ids) && invoice.visit_ids.includes(visit.visit_id)
  );
}

function getRouteVisits(state, date, isOverdueView) {
  const today = new Date().toISOString().slice(0, 10);
  if (isOverdueView) {
    return (state.visits || [])
      .filter((visit) => visit.status === 'scheduled' && visit.visit_date && visit.visit_date < today)
      .sort((a, b) => String(a.visit_date || '').localeCompare(String(b.visit_date || '')));
  }

  return (state.visits || [])
    .filter((visit) => visit.visit_date === date)
    .sort((a, b) => String(a.visit_date || '').localeCompare(String(b.visit_date || '')));
}

function getRouteMetrics(visits, state) {
  const scheduled = visits.filter((visit) => visit.status === 'scheduled').length;
  const completed = visits.filter((visit) => visit.status === 'completed').length;
  const skipped = visits.filter((visit) => visit.status === 'skipped').length;
  const remaining = visits.filter((visit) => !['completed', 'skipped'].includes(visit.status)).length;
  const readyToBillVisits = visits.filter((visit) => visit.status === 'completed' && !visitIsInvoiced(visit, state));
  const readyToBillValue = readyToBillVisits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  return { scheduled, completed, skipped, remaining, readyToBillVisits, readyToBillValue };
}

function getWorkerName(visit) {
  return visit.worker_name || visit.assigned_worker || visit.crew_name || visit.route_name || 'Unassigned / Office Route';
}

function groupVisitsByWorker(visits) {
  return visits.reduce((groups, visit) => {
    const workerName = getWorkerName(visit);
    if (!groups[workerName]) groups[workerName] = [];
    groups[workerName].push(visit);
    return groups;
  }, {});
}

function renderStat(label, value) {
  return `<article class="route-stat"><span>${label}</span><strong>${value}</strong></article>`;
}

function stopStateClass(visit) {
  if (visit.status === 'completed') return 'completed';
  if (visit.status === 'skipped') return 'skipped';
  return 'upcoming';
}

function stopStateLabel(visit) {
  if (visit.status === 'completed') return '✓ Completed';
  if (visit.status === 'skipped') return 'Skipped';
  return 'Scheduled';
}

function renderRouteStop(visit, index, customers, properties) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const stateClass = stopStateClass(visit);

  return `
    <article class="panel route-flow-stop ${stateClass}">
      <p class="route-stop-kicker">Stop ${index + 1} · ${stopStateLabel(visit)}</p>
      <h3>${customer?.name || 'Unknown Customer'}</h3>
      <p>${property?.service_address || 'Unknown address'}</p>
      <p>${visit.service_description || property?.service_type || 'Service'}</p>
      <p>${property?.service_type || 'Service'} · ${property?.recurring_frequency || 'n/a'}</p>
      <p>Visit date ${visit.visit_date}</p>
      <p>Price ${currency(visit.price)}</p>
      <p>Notes: ${visit.notes || 'None'}</p>
      <p>Status: ${visit.status}</p>
      <div class="actions">
        <button type="button" data-flow-visit-action="${visit.visit_id}:complete">Mark Completed</button>
        <button type="button" data-flow-visit-action="${visit.visit_id}:skip">Mark Skipped</button>
        <button type="button" data-flow-visit-action="${visit.visit_id}:skip-reschedule">Skip + Reschedule</button>
      </div>
    </article>
  `;
}

function renderWorkerRoute(workerName, visits, customers, properties) {
  const sortedVisits = [...visits].sort((a, b) => {
    const aOrder = String(a.route_order || a.stop_order || a.visit_time || a.start_time || a.visit_date || '');
    const bOrder = String(b.route_order || b.stop_order || b.visit_time || b.start_time || b.visit_date || '');
    return aOrder.localeCompare(bOrder);
  });
  const completed = visits.filter((visit) => visit.status === 'completed').length;
  const remaining = visits.filter((visit) => !['completed', 'skipped'].includes(visit.status)).length;

  return `
    <section class="panel worker-route-section">
      <div class="customer-card-header">
        <div>
          <h3>${workerName}</h3>
          <p>${visits.length} visit${visits.length === 1 ? '' : 's'} · ${completed} completed · ${remaining} remaining</p>
        </div>
      </div>
      <div class="stack route-flow-list">
        ${sortedVisits.map((visit, index) => renderRouteStop(visit, index, customers, properties)).join('')}
      </div>
    </section>
  `;
}

function findRouteSection() {
  return Array.from(document.querySelectorAll('main.content section')).find((candidate) => {
    const title = candidate.querySelector('h2')?.textContent?.trim();
    return title === 'Today’s Route / Daily Work List' || title === 'Overdue Visits';
  });
}

function enhanceTodayRoute(force = false) {
  const section = findRouteSection();
  if (!section || (section.dataset.todayRouteFlow === 'true' && !force)) return;

  const state = loadState();
  if (!state) return;

  const title = section.querySelector('h2')?.textContent?.trim() || 'Today’s Route';
  const isOverdueView = title === 'Overdue Visits';
  const date = getSelectedRouteDate();
  const customers = customerMap(state);
  const properties = propertyMap(state);
  const visits = getRouteVisits(state, date, isOverdueView);
  const metrics = getRouteMetrics(visits, state);
  const routeGroups = groupVisitsByWorker(visits);
  const dateControl = section.querySelector('#route-date')?.closest('.panel')?.outerHTML || '';

  section.dataset.todayRouteFlow = 'true';
  section.classList.add('today-route-flow');
  section.innerHTML = `
    <div class="panel route-summary-header">
      <div class="customer-card-header">
        <div>
          <h2>${isOverdueView ? 'Overdue Visits' : 'Today’s Route'}</h2>
          <p>${isOverdueView ? 'Scheduled visits older than today.' : `Daily operations view for ${date}.`}</p>
        </div>
        <div class="actions">
          <button type="button" data-flow-ready-to-bill>Open Ready to Bill</button>
        </div>
      </div>
      <div class="route-flow-stats">
        ${renderStat('Workers / Routes', Object.keys(routeGroups).length)}
        ${renderStat('Visits Scheduled', visits.length)}
        ${renderStat('Completed', metrics.completed)}
        ${renderStat('Remaining', metrics.remaining)}
        ${renderStat('Ready to Bill', currency(metrics.readyToBillValue))}
      </div>
      <p><strong>Today’s Route is for daily operations.</strong> Ready-to-Bill is shown as a secondary shortcut for completed, uninvoiced visits.</p>
    </div>
    ${dateControl}
    <div class="stack worker-route-list">
      ${visits.length ? Object.entries(routeGroups).map(([workerName, workerVisits]) => renderWorkerRoute(workerName, workerVisits, customers, properties)).join('') : '<article class="panel"><p>No visits found for this route view.</p></article>'}
    </div>
  `;
}

function refreshTodayRouteFlow() {
  const section = document.querySelector('main.content section.today-route-flow');
  if (!section) return;
  section.dataset.todayRouteFlow = 'false';
  enhanceTodayRoute(true);
}

function updateVisitStatus(visitId, status) {
  const state = loadState();
  if (!state) return;

  state.visits = (state.visits || []).map((visit) => {
    if (visit.visit_id !== visitId) return visit;
    return {
      ...visit,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : visit.completed_at,
      skipped_at: status === 'skipped' ? new Date().toISOString() : visit.skipped_at
    };
  });

  saveState(state);
  refreshTodayRouteFlow();
}

function skipAndRescheduleVisit(visitId) {
  const state = loadState();
  if (!state) return;

  const visit = (state.visits || []).find((item) => item.visit_id === visitId);
  if (!visit) return;

  const nextDate = window.prompt('Reschedule date (YYYY-MM-DD):', visit.visit_date || new Date().toISOString().slice(0, 10));
  if (!nextDate) return;

  state.visits = (state.visits || []).map((item) =>
    item.visit_id === visitId
      ? { ...item, status: 'skipped', skipped_at: new Date().toISOString(), rescheduled_to: nextDate }
      : item
  );

  state.visits = [
    ...(state.visits || []),
    {
      ...visit,
      visit_id: `visit_${crypto.randomUUID().slice(0, 8)}`,
      visit_date: nextDate,
      status: 'scheduled',
      notes: visit.notes || 'Rescheduled visit',
      created_at: new Date().toISOString()
    }
  ];

  saveState(state);
  refreshTodayRouteFlow();
}

function goToReadyToBill() {
  document.querySelector('[data-nav="batch"]')?.click();
}

function handleFlowClick(event) {
  const readyButton = event.target.closest('[data-flow-ready-to-bill]');
  if (readyButton) {
    event.preventDefault();
    event.stopPropagation();
    goToReadyToBill();
    return;
  }

  const button = event.target.closest('[data-flow-visit-action]');
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const [visitId, action] = button.dataset.flowVisitAction.split(':');
  if (!visitId || !action) return;

  if (action === 'complete') updateVisitStatus(visitId, 'completed');
  if (action === 'skip') updateVisitStatus(visitId, 'skipped');
  if (action === 'skip-reschedule') skipAndRescheduleVisit(visitId);
}

let scheduled = false;
function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceTodayRoute();
  });
}

document.addEventListener('click', handleFlowClick, true);

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleEnhancement();
