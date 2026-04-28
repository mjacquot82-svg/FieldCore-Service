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

function renderVisitCheckbox(visit, customers, properties) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const label = `${customer?.name || 'Unknown Customer'} · ${property?.service_address || 'Unknown address'} · ${visit.service_description}`;

  return `
    <label class="route-stop-option">
      <input type="checkbox" name="visit_id" value="${visit.visit_id}" />
      <span>
        <strong>${label}</strong>
        <small>${property?.service_type || 'Service'} · ${currency(visit.price)} · ${visit.notes || 'No notes'}</small>
      </span>
    </label>
  `;
}

function renderSavedRoute(route, state) {
  const customers = customerMap(state);
  const properties = propertyMap(state);
  const visitsById = new Map((state.visits || []).map((visit) => [visit.visit_id, visit]));
  const routeVisits = (route.visit_ids || []).map((visitId) => visitsById.get(visitId)).filter(Boolean);

  return `
    <article class="panel route-summary-card">
      <div class="customer-card-header">
        <div>
          <h3>${route.name}</h3>
          <p>${route.route_date} · ${route.assigned_worker || 'Unassigned'}</p>
        </div>
        <span class="badge paid-up">${routeVisits.length} stops</span>
      </div>
      <ol>
        ${routeVisits.map((visit) => {
          const property = properties[visit.property_id];
          const customer = customers[property?.customer_id];
          return `<li>${customer?.name || 'Unknown Customer'} · ${property?.service_address || 'Unknown address'} · ${visit.service_description}</li>`;
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

  main.innerHTML = `
    <section>
      <h2>Route Builder</h2>
      <div class="panel">
        <label>Select route date
          <input type="date" id="route-builder-date" value="${date}" />
        </label>
      </div>

      <form id="route-builder-form" class="panel service-form">
        <h3>Create Route</h3>
        <label>Route Name
          <input name="route_name" placeholder="Monday North Route" required />
        </label>
        <label>Assign Worker
          <input name="assigned_worker" placeholder="Worker name" />
        </label>
        <h4>Scheduled Stops for ${date}</h4>
        <div class="route-stop-list">
          ${visits.length ? visits.map((visit) => renderVisitCheckbox(visit, customers, properties)).join('') : '<p>No scheduled visits found for this date.</p>'}
        </div>
        <button class="primary" type="submit" ${visits.length ? '' : 'disabled'}>Save Route</button>
      </form>

      <h3>Saved Routes for ${date}</h3>
      <div class="stack">
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
