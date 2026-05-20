import { getCustomerMap, getPropertyMap } from './lib/store.js';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const today = () => new Date().toISOString().slice(0, 10);
const makeRouteId = () => `route_${crypto.randomUUID().slice(0, 8)}`;
const routeDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weekdayForDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Monday';
  return parsed.toLocaleDateString('en-US', { weekday: 'long' });
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

function renderRouteDaySelect(selectedDay) {
  return `<select name="route_day" required>${routeDays.map((day) => `<option value="${day}" ${day === selectedDay ? 'selected' : ''}>${day}</option>`).join('')}</select>`;
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
  const customers = getCustomerMap(state);
  const properties = getPropertyMap(state);
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
          return `<li><strong>${customer?.name || 'Unknown Customer'}</strong><span>${property?.service_address || 'Unknown address'} · ${visit.service_description}</span></li>`;
        }).join('') || '<li>No stops found.</li>'}
      </ol>
    </article>
  `;
}

export function renderRouteBuilder(state, date = today()) {
  const customers = getCustomerMap(state);
  const properties = getPropertyMap(state);
  const routeDay = weekdayForDate(date);
  const visits = scheduledVisitsForDate(state, date);
  const savedRoutes = (state.routes || []).filter((route) => route.route_date === date);
  const metrics = getRouteMetrics(visits, savedRoutes);

  return `
    <section class="route-builder-view">
      <div class="route-builder-header panel">
        <div>
          <h2>Route Builder</h2>
          <p>Build weekday routes by worker. The date is a preview for scheduled stops only.</p>
        </div>
        <label>Preview scheduled visits for
          <input type="date" id="route-builder-date" value="${date}" />
        </label>
      </div>

      <div class="route-stat-grid">
        ${renderRouteStat('Weekday route', routeDay)}
        ${renderRouteStat('Scheduled stops', visits.length)}
        ${renderRouteStat('Unassigned stops', metrics.unassignedStops)}
        ${renderRouteStat('Saved routes', savedRoutes.length)}
        ${renderRouteStat('Route value', currency(metrics.totalValue))}
      </div>

      <form id="route-builder-form" class="panel service-form route-builder-form">
        <div class="route-form-header">
          <div>
            <h3>Create Weekday Route</h3>
            <p>Choose the weekday, assign the worker, then select stops from the preview date.</p>
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
        <h4>Stops available for ${routeDay} preview (${date})</h4>
        <div class="route-stop-list">
          ${visits.length ? visits.map((visit) => renderVisitCheckbox(visit, customers, properties, metrics.routedVisitIds)).join('') : '<p>No scheduled visits found for this preview date.</p>'}
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
}

export function bindRouteBuilderEvents(state, saveStateFn, setRouteBuilderDate, render) {
  const dateInput = document.querySelector('#route-builder-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      setRouteBuilderDate(dateInput.value);
      render();
    });
  }

  const form = document.querySelector('#route-builder-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const selectedVisitIds = formData.getAll('visit_id');
    const routeDay = String(formData.get('route_day') || weekdayForDate(dateInput?.value || today())).trim();
    const routeName = String(formData.get('route_name') || '').trim();
    const assignedWorker = String(formData.get('assigned_worker') || '').trim();
    const routeDate = dateInput?.value || today();

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

    saveStateFn(state);
    render();
  });
}
