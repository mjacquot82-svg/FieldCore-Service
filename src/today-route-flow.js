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
  const readyToBillVisits = visits.filter((visit) => visit.status === 'completed' && !visitIsInvoiced(visit, state));
  const readyToBillValue = readyToBillVisits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  return { scheduled, completed, skipped, readyToBillVisits, readyToBillValue };
}

function renderStat(label, value) {
  return `<article class="route-stat"><span>${label}</span><strong>${value}</strong></article>`;
}

function stopStateClass(visit, firstOpenVisitId) {
  if (visit.status === 'completed') return 'completed';
  if (visit.status === 'skipped') return 'skipped';
  if (visit.visit_id === firstOpenVisitId) return 'current';
  return 'upcoming';
}

function stopStateLabel(visit, firstOpenVisitId) {
  if (visit.status === 'completed') return '✓ Completed';
  if (visit.status === 'skipped') return 'Skipped';
  if (visit.visit_id === firstOpenVisitId) return '▶ Current stop';
  return 'Upcoming';
}

function renderRouteStop(visit, index, customers, properties, firstOpenVisitId) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const stateClass = stopStateClass(visit, firstOpenVisitId);

  return `
    <article class="panel route-flow-stop ${stateClass}">
      <p class="route-stop-kicker">Stop ${index + 1} · ${stopStateLabel(visit, firstOpenVisitId)}</p>
      <h3>${customer?.name || 'Unknown Customer'}</h3>
      <p>${property?.service_address || 'Unknown address'}</p>
      <p>${visit.service_description || property?.service_type || 'Service'}</p>
      <p>${property?.service_type || 'Service'} · ${property?.recurring_frequency || 'n/a'}</p>
      <p>Visit date ${visit.visit_date}</p>
      <p>Price ${currency(visit.price)}</p>
      <p>Notes: ${visit.notes || 'None'}</p>
      <p>Status: ${visit.status}</p>
      <div class="actions">
        <button data-visit-action="${visit.visit_id}:complete">Mark Completed</button>
        <button data-visit-action="${visit.visit_id}:skip">Mark Skipped</button>
        <button data-visit-action="${visit.visit_id}:skip-reschedule">Skip + Reschedule</button>
      </div>
    </article>
  `;
}

function enhanceTodayRoute() {
  const section = Array.from(document.querySelectorAll('main.content section')).find((candidate) => {
    const title = candidate.querySelector('h2')?.textContent?.trim();
    return title === 'Today’s Route / Daily Work List' || title === 'Overdue Visits';
  });

  if (!section || section.dataset.todayRouteFlow === 'true') return;

  const state = loadState();
  if (!state) return;

  const title = section.querySelector('h2')?.textContent?.trim() || 'Today’s Route';
  const isOverdueView = title === 'Overdue Visits';
  const date = getSelectedRouteDate();
  const customers = customerMap(state);
  const properties = propertyMap(state);
  const visits = getRouteVisits(state, date, isOverdueView);
  const metrics = getRouteMetrics(visits, state);
  const firstOpenVisit = visits.find((visit) => visit.status === 'scheduled');
  const dateControl = section.querySelector('.panel')?.outerHTML || '';

  section.dataset.todayRouteFlow = 'true';
  section.classList.add('today-route-flow');
  section.innerHTML = `
    <div class="panel route-summary-header">
      <div>
        <h2>${title}</h2>
        <p>${isOverdueView ? 'Scheduled visits older than today.' : `Execution view for ${date}.`}</p>
      </div>
      <div class="route-ready-value">${currency(metrics.readyToBillValue)}</div>
      <p><strong>Ready-to-bill value</strong> from completed, uninvoiced visits.</p>
    </div>
    ${dateControl}
    <div class="route-flow-stats">
      ${renderStat('Stops shown', visits.length)}
      ${renderStat('Scheduled', metrics.scheduled)}
      ${renderStat('Completed', metrics.completed)}
      ${renderStat('Skipped', metrics.skipped)}
    </div>
    <div class="stack route-flow-list">
      ${visits.length ? visits.map((visit, index) => renderRouteStop(visit, index, customers, properties, firstOpenVisit?.visit_id)).join('') : '<article class="panel"><p>No visits found for this route view.</p></article>'}
    </div>
    <article class="panel route-summary-footer">
      <h3>Route Summary</h3>
      <div class="route-flow-stats">
        ${renderStat('Completed visits', metrics.completed)}
        ${renderStat('Skipped visits', metrics.skipped)}
        ${renderStat('Remaining visits', metrics.scheduled)}
        ${renderStat('Ready to bill', currency(metrics.readyToBillValue))}
      </div>
    </article>
  `;
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

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleEnhancement();
