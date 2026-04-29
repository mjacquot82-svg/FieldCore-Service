const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const ROUTE_BUILDER_ID = 'route-builder';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const today = () => new Date().toISOString().slice(0, 10);
const makeRouteId = () => `route_${crypto.randomUUID().slice(0, 8)}`;
const routeDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

function normalizePreferredDay(value) {
  const day = String(value || '').trim();
  if (day === 'Unassigned') return 'No preference';
  if (routeDays.includes(day)) return day;
  return 'No preference';
}

function customerPreferredDay(customer) {
  return normalizePreferredDay(customer?.preferred_service_day || customer?.preferred_day);
}

function preferredDayMatchesRoute(customer, routeDay) {
  return customerPreferredDay(customer) === routeDay;
}

function routeSuggestionRank(visit, customers, properties, routeDay, routedVisitIds) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  let score = 0;

  if (preferredDayMatchesRoute(customer, routeDay)) score += 100;
  if (routedVisitIds.has(visit.visit_id)) score -= 1000;
  if (property?.recurring_frequency === 'weekly') score += 12;
  if (property?.recurring_frequency === 'biweekly') score += 8;
  if (property?.recurring_frequency === 'monthly') score += 4;
  if (visit.notes || property?.notes) score += 1;

  return score;
}

function sortVisitsForRouteSuggestions(visits, customers, properties, routeDay, routedVisitIds) {
  return [...visits].sort((a, b) => {
    const scoreDiff = routeSuggestionRank(b, customers, properties, routeDay, routedVisitIds) - routeSuggestionRank(a, customers, properties, routeDay, routedVisitIds);
    if (scoreDiff !== 0) return scoreDiff;

    const aProperty = properties[a.property_id];
    const bProperty = properties[b.property_id];
    const aCustomer = customers[aProperty?.customer_id];
    const bCustomer = customers[bProperty?.customer_id];

    return `${aCustomer?.name || ''} ${aProperty?.service_address || ''}`.localeCompare(`${bCustomer?.name || ''} ${bProperty?.service_address || ''}`);
  });
}

function weekdayForDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Monday';
  return parsed.toLocaleDateString('en-US', { weekday: 'long' });
}

function addRouteBuilderNav() {
  document.querySelectorAll('nav').forEach((nav) => {
    if (nav.querySelector(`[data-enhanced-nav="${ROUTE_BUILDER_ID}"]`)) return;

    const button = document.createElement('button');
    button.className = 'nav-btn';
    button.dataset.enhancedNav = ROUTE_BUILDER_ID;
    button.textContent = 'Route Builder';
    nav.appendChild(button);
  });
}

function getRouteBuilderDate() {
  return document.querySelector('#route-builder-date')?.value || today();
}

function scheduledVisitsForDate(state, date) {
  return (state.visits || [])
    .filter((visit) => visit.visit_date === date && visit.status === 'scheduled')
    .sort((a, b) => (a.service_description || '').localeCompare(b.service_description || ''));
}

function getRouteMetrics(visits, savedRoutes, customers = {}, properties = {}, routeDay = '') {
  const routedVisitIds = new Set(savedRoutes.flatMap((route) => route.visit_ids || []));
  const unassignedStops = visits.filter((visit) => !routedVisitIds.has(visit.visit_id)).length;
  const totalValue = visits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  const preferredDayStops = visits.filter((visit) => {
    const property = properties[visit.property_id];
    const customer = customers[property?.customer_id];
    return preferredDayMatchesRoute(customer, routeDay);
  }).length;

  return { routedVisitIds, unassignedStops, totalValue, preferredDayStops };
}

function renderRouteStat(label, value) {
  return `<article class="route-stat"><span>${label}</span><strong>${value}</strong></article>`;
}

function renderRouteDaySelect(selectedDay) {
  return `<select name="route_day" required>${routeDays.map((day) => `<option value="${day}" ${day === selectedDay ? 'selected' : ''}>${day}</option>`).join('')}</select>`;
}

function renderVisitCheckbox(visit, customers, properties, routeDay, routedVisitIds = new Set()) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const isRouted = routedVisitIds.has(visit.visit_id);
  const city = (property?.service_address || '').split(',').slice(-2, -1)[0]?.trim();
  const preferredDay = customerPreferredDay(customer);
  const matchesPreferredDay = preferredDayMatchesRoute(customer, routeDay);

  return `
    <label class="route-stop-card ${isRouted ? 'already-routed' : ''} ${matchesPreferredDay ? 'preferred-day-match' : ''}">
      <input type="checkbox" name="visit_id" value="${visit.visit_id}" ${isRouted ? 'disabled' : ''} />
      <div class="route-stop-main">
        <div class="route-stop-title-row">
          <strong>${customer?.name || 'Unknown Customer'}</strong>
          <span class="badge ${isRouted ? 'outstanding' : 'paid-up'}">${isRouted ? 'Routed' : 'Open'}</span>
        </div>
        <p>${property?.service_address || 'Unknown address'}</p>
        <div class="route-stop-meta">
          <span>${property?.recurring_frequency || 'one-time'}</span>
          <span>${property?.service_type || 'Service'}</span>
          <span>${currency(visit.price)}</span>
          ${city ? `<span>${city}</span>` : ''}
          <span>Preferred: ${preferredDay}</span>
          ${matchesPreferredDay ? '<span class="badge paid-up">Preferred today</span>' : ''}
        </div>
        ${visit.notes ? `<small>${visit.notes}</small>` : ''}
      </div>
    </label>
  `;
}

function renderSavedRoute(route, state) {
  const customers = customerMap(state);
  const properties = propertyMap(state);
  const visitsById = new Map((state.visits || []).map((visit) => [visit.visit_id, visit]));
  const routeVisits = (route.visit_ids || []).map((visitId) => visitsById.get(visitId)).filter(Boolean);
  const routeTotal = routeVisits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  const routeDay = route.route_day || weekdayForDate(route.route_date);

  return `
    <article class="panel route-summary-card">
      <div class="customer-card-header">
        <div>
          <h3>${routeDay} · ${route.name}</h3>
          <p>${route.assigned_worker || 'Unassigned'} · preview ${route.route_date} · ${currency(routeTotal)}</p>
        </div>
        <span class="badge paid-up">${routeVisits.length} stops</span>
      </div>
      <ol class="route-saved-stop-list">
        ${routeVisits.map((visit) => {
          const property = properties[visit.property_id];
          const customer = customers[property?.customer_id];
          const preferredDay = customerPreferredDay(customer);
          const preferredLabel = preferredDay === routeDay ? ' · preferred day match' : preferredDay !== 'No preference' ? ` · prefers ${preferredDay}` : '';
          return `<li><strong>${customer?.name || 'Unknown Customer'}</strong><span>${property?.service_address || 'Unknown address'} · ${visit.service_description}${preferredLabel}</span></li>`;
        }).join('') || '<li>No stops found.</li>'}
      </ol>
    </article>
  `;
}

function renderRouteBuilder(date = today()) {
  const state = loadState();
  if (!state) return;

  const main = document.querySelector('main.content');
  if (!main) return;

  const customers = customerMap(state);
  const properties = propertyMap(state);
  const routeDay = weekdayForDate(date);
  const visits = scheduledVisitsForDate(state, date);
  const savedRoutes = (state.routes || []).filter((route) => route.route_date === date);
  const metrics = getRouteMetrics(visits, savedRoutes, customers, properties, routeDay);
  const suggestedVisits = sortVisitsForRouteSuggestions(visits, customers, properties, routeDay, metrics.routedVisitIds);

  main.innerHTML = `
    <section class="route-builder-view">
      <div class="route-builder-header panel">
        <div>
          <h2>Route Builder</h2>
          <p>Build weekday routes by worker. Customers who prefer ${routeDay} are suggested first, but can still be scheduled any day.</p>
        </div>
        <label>Preview scheduled visits for
          <input type="date" id="route-builder-date" value="${date}" />
        </label>
      </div>

      <div class="route-stat-grid">
        ${renderRouteStat('Weekday route', routeDay)}
        ${renderRouteStat('Scheduled stops', visits.length)}
        ${renderRouteStat('Preferred-day matches', metrics.preferredDayStops)}
        ${renderRouteStat('Unassigned stops', metrics.unassignedStops)}
        ${renderRouteStat('Saved routes', savedRoutes.length)}
        ${renderRouteStat('Route value', currency(metrics.totalValue))}
      </div>

      <form id="route-builder-form" class="panel service-form route-builder-form">
        <div class="route-form-header">
          <div>
            <h3>Create Weekday Route</h3>
            <p>Choose the weekday, assign the worker, then select suggested stops from the preview date.</p>
          </div>
          <button class="primary" type="submit" ${metrics.unassignedStops ? '' : 'disabled'}>Save Route</button>
        </div>
        <div class="route-form-grid">
          <label>Weekday Route
            ${renderRouteDaySelect(routeDay)}
          </label>
          <label>Assign Worker
            <input name="assigned_worker" placeholder="Worker name" />
          </label>
          <label>Route Area / Name
            <input name="route_name" placeholder="North Route, Franklin Route, Commercial Route" required />
          </label>
        </div>
        <h4>Suggested stops for ${routeDay} preview (${date})</h4>
        <p>Preferred-day customers appear first. This is only a suggestion — the owner can still choose any open stop.</p>
        <div class="route-stop-list">
          ${suggestedVisits.length ? suggestedVisits.map((visit) => renderVisitCheckbox(visit, customers, properties, routeDay, metrics.routedVisitIds)).join('') : '<p>No scheduled visits found for this preview date.</p>'}
        </div>
      </form>

      <div class="route-section-header">
        <h3>Saved ${routeDay} Routes</h3>
        <span>${savedRoutes.length} routes for preview date ${date}</span>
      </div>
      <div class="stack route-saved-stack">
        ${savedRoutes.length ? savedRoutes.map((route) => renderSavedRoute(route, state)).join('') : '<article class="panel"><p>No saved routes for this preview date yet.</p></article>'}
      </div>
    </section>
  `;

  bindRouteBuilderEvents();
}

function bindRouteBuilderEvents() {
  const dateInput = document.querySelector('#route-builder-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => renderRouteBuilder(dateInput.value));
  }

  const daySelect = document.querySelector('#route-builder-form [name="route_day"]');
  if (daySelect) {
    daySelect.addEventListener('change', () => {
      const selectedDate = getRouteBuilderDate();
      const selectedDay = daySelect.value;
      document.querySelector('.route-builder-header p').textContent = `Build weekday routes by worker. Customers who prefer ${selectedDay} are suggested first, but can still be scheduled any day.`;
    });
  }

  const form = document.querySelector('#route-builder-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const state = loadState();
    if (!state) return;

    const formData = new FormData(form);
    const selectedVisitIds = formData.getAll('visit_id');
    const routeDay = String(formData.get('route_day') || weekdayForDate(getRouteBuilderDate())).trim();
    const routeName = String(formData.get('route_name') || '').trim();
    const assignedWorker = String(formData.get('assigned_worker') || '').trim();
    const routeDate = getRouteBuilderDate();

    if (!routeName || selectedVisitIds.length === 0) return;

    const route = {
      route_id: makeRouteId(),
      company_id: state.company?.company_id,
      name: routeName,
      route_day: routeDay,
      route_date: routeDate,
      assigned_worker: assignedWorker,
      visit_ids: selectedVisitIds,
      created_at: new Date().toISOString()
    };

    state.routes = [...(state.routes || []), route];
    state.visits = (state.visits || []).map((visit) =>
      selectedVisitIds.includes(visit.visit_id)
        ? { ...visit, route_id: route.route_id, route_name: route.name, route_day: route.route_day, assigned_worker: route.assigned_worker }
        : visit
    );

    saveState(state);
    renderRouteBuilder(routeDate);
  });
}

function setActiveRouteBuilderButton() {
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
  document.querySelectorAll(`[data-enhanced-nav="${ROUTE_BUILDER_ID}"]`).forEach((button) => button.classList.add('active'));
}

document.addEventListener('click', (event) => {
  const routeBuilderButton = event.target.closest(`[data-enhanced-nav="${ROUTE_BUILDER_ID}"]`);
  if (!routeBuilderButton) return;

  event.preventDefault();
  setActiveRouteBuilderButton();
  renderRouteBuilder();
});

const observer = new MutationObserver(addRouteBuilderNav);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addRouteBuilderNav();
