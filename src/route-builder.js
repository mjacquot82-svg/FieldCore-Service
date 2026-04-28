const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const ROUTE_BUILDER_ID = 'route-builder';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const today = () => new Date().toISOString().slice(0, 10);
const makeRouteId = () => `route_${crypto.randomUUID().slice(0, 8)}`;

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

function getRouteMetrics(visits, savedRoutes) {
  const routedVisitIds = new Set(savedRoutes.flatMap((route) => route.visit_ids || []));
  const unassignedStops = visits.filter((visit) => !routedVisitIds.has(visit.visit_id)).length;
  const totalValue = visits.reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  return { routedVisitIds, unassignedStops, totalValue };
}

function renderRouteStat(label, value) {
  return `<article class="route-stat"><span>${label}</span><strong>${value}</strong></article>`;
}

function renderVisitCheckbox(visit, customers, properties, routedVisitIds = new Set()) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const isRouted = routedVisitIds.has(visit.visit_id);
  const city = (property?.service_address || '').split(',').slice(-2, -1)[0]?.trim();

  return `
    <label class="route-stop-card ${isRouted ? 'already-routed' : ''}">
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

  return `
    <article class="panel route-summary-card">
      <div class="customer-card-header">
        <div>
          <h3>${route.name}</h3>
          <p>${route.route_date} · ${route.assigned_worker || 'Unassigned'} · ${currency(routeTotal)}</p>
        </div>
        <span class="badge paid-up">${routeVisits.length} stops</span>
      </div>
      <ol class="route-saved-stop-list">
        ${routeVisits.map((visit) => {
          const property = properties[visit.property_id];
          const customer = customers[property?.customer_id];
          return `<li><strong>${customer?.name || 'Unknown Customer'}</strong><span>${property?.service_address || 'Unknown address'} · ${visit.service_description}</span></li>`;
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
  const visits = scheduledVisitsForDate(state, date);
  const savedRoutes = (state.routes || []).filter((route) => route.route_date === date);
  const metrics = getRouteMetrics(visits, savedRoutes);

  main.innerHTML = `
    <section class="route-builder-view">
      <div class="route-builder-header">
        <div>
          <h2>Route Builder</h2>
          <p>Build daily routes from scheduled visits without changing the recurring schedule engine.</p>
        </div>
        <label>Select route date
          <input type="date" id="route-builder-date" value="${date}" />
        </label>
      </div>

      <div class="route-stat-grid">
        ${renderRouteStat('Scheduled stops', visits.length)}
        ${renderRouteStat('Unassigned stops', metrics.unassignedStops)}
        ${renderRouteStat('Saved routes', savedRoutes.length)}
        ${renderRouteStat('Route value', currency(metrics.totalValue))}
      </div>

      <form id="route-builder-form" class="panel service-form route-builder-form">
        <div class="route-form-header">
          <div>
            <h3>Create Route</h3>
            <p>Select open stops, assign a worker, then save the route.</p>
          </div>
          <button class="primary" type="submit" ${metrics.unassignedStops ? '' : 'disabled'}>Save Route</button>
        </div>
        <div class="route-form-grid">
          <label>Route Name
            <input name="route_name" placeholder="Monday North Route" required />
          </label>
          <label>Assign Worker
            <input name="assigned_worker" placeholder="Worker name" />
          </label>
        </div>
        <h4>Scheduled Stops for ${date}</h4>
        <div class="route-stop-list">
          ${visits.length ? visits.map((visit) => renderVisitCheckbox(visit, customers, properties, metrics.routedVisitIds)).join('') : '<p>No scheduled visits found for this date.</p>'}
        </div>
      </form>

      <div class="route-section-header">
        <h3>Saved Routes for ${date}</h3>
        <span>${savedRoutes.length} routes</span>
      </div>
      <div class="stack route-saved-stack">
        ${savedRoutes.length ? savedRoutes.map((route) => renderSavedRoute(route, state)).join('') : '<article class="panel"><p>No saved routes for this date yet.</p></article>'}
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

  const form = document.querySelector('#route-builder-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const state = loadState();
    if (!state) return;

    const formData = new FormData(form);
    const selectedVisitIds = formData.getAll('visit_id');
    const routeName = String(formData.get('route_name') || '').trim();
    const assignedWorker = String(formData.get('assigned_worker') || '').trim();
    const routeDate = getRouteBuilderDate();

    if (!routeName || selectedVisitIds.length === 0) return;

    const route = {
      route_id: makeRouteId(),
      company_id: state.company?.company_id,
      name: routeName,
      route_date: routeDate,
      assigned_worker: assignedWorker,
      visit_ids: selectedVisitIds,
      created_at: new Date().toISOString()
    };

    state.routes = [...(state.routes || []), route];
    state.visits = (state.visits || []).map((visit) =>
      selectedVisitIds.includes(visit.visit_id)
        ? { ...visit, route_id: route.route_id, route_name: route.name, assigned_worker: route.assigned_worker }
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
