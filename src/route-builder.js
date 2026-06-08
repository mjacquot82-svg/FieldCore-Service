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

function getRouteAssignmentMap(routes = []) {
  return routes.reduce((assignments, route) => {
    (route.visit_ids || []).forEach((visitId) => {
      if (!assignments.has(visitId)) assignments.set(visitId, route);
    });
    return assignments;
  }, new Map());
}

function routeLabel(route) {
  const worker = route.assigned_worker || 'Unassigned worker';
  return `${worker} - ${route.name}`;
}

function removeVisitFromRoutes(routes = [], visitId) {
  return routes.map((route) => ({
    ...route,
    visit_ids: (route.visit_ids || []).filter((id) => id !== visitId)
  }));
}

function updateVisitRoute(state, visitId, route) {
  state.visits = (state.visits || []).map((visit) => {
    if (visit.visit_id !== visitId) return visit;
    if (!route) {
      const { route_id, route_name, route_day, assigned_worker, ...unassignedVisit } = visit;
      return unassignedVisit;
    }
    return {
      ...visit,
      route_id: route.route_id,
      route_name: route.name,
      route_day: route.route_day,
      assigned_worker: route.assigned_worker
    };
  });
}

function renderRouteStat(label, value) {
  return `<article class="route-stat"><span>${label}</span><strong>${value}</strong></article>`;
}

function renderRouteDaySelect(selectedDay) {
  return `<select name="route_day" required>${routeDays.map((day) => `<option value="${day}" ${day === selectedDay ? 'selected' : ''}>${day}</option>`).join('')}</select>`;
}

function renderRouteTargetOptions(savedRoutes, currentRouteId = '') {
  return savedRoutes.map((route) => `
    <option value="${route.route_id}" ${route.route_id === currentRouteId ? 'selected' : ''}>${routeLabel(route)}</option>
  `).join('');
}

function renderVisitCheckbox(visit, customers, properties, routeAssignment, savedRoutes = []) {
  const property = properties[visit.property_id];
  const customer = customers[property?.customer_id];
  const assignedRoute = routeAssignment.get(visit.visit_id);
  const isRouted = Boolean(assignedRoute);
  const city = (property?.service_address || '').split(',').slice(-2, -1)[0]?.trim();
  const workerName = assignedRoute?.assigned_worker || visit.assigned_worker || 'Unassigned worker';
  const routeOptions = renderRouteTargetOptions(savedRoutes, assignedRoute?.route_id);

  return `
    <article class="route-stop-card ${isRouted ? 'already-routed' : ''}">
      <label class="route-stop-select">
        <input type="checkbox" name="visit_id" value="${visit.visit_id}" ${isRouted ? 'disabled' : ''} />
      </label>
      <div class="route-stop-main">
        <div class="route-stop-title-row">
          <strong>${customer?.name || 'Unknown Customer'}</strong>
          <span class="badge ${isRouted ? 'outstanding' : 'paid-up'}">${isRouted ? `Assigned to: ${workerName}` : 'Unassigned'}</span>
        </div>
        <p>${property?.service_address || 'Unknown address'}</p>
        <div class="route-stop-meta">
          <span>${property?.recurring_frequency || 'one-time'}</span>
          <span>${property?.service_type || 'Service'}</span>
          <span>${currency(visit.price)}</span>
          ${city ? `<span>${city}</span>` : ''}
          ${assignedRoute ? `<span>${assignedRoute.name}</span>` : ''}
        </div>
        ${visit.notes ? `<small>${visit.notes}</small>` : ''}
        <div class="route-stop-actions">
          <select data-route-target="${visit.visit_id}" ${savedRoutes.length ? '' : 'disabled'}>
            ${routeOptions || '<option value="">No saved routes</option>'}
          </select>
          <button type="button" data-route-move-stop="${visit.visit_id}" ${savedRoutes.length ? '' : 'disabled'}>${isRouted ? 'Reassign' : 'Assign'}</button>
          ${isRouted ? `<button type="button" data-route-remove-stop="${visit.visit_id}">Remove from Route</button>` : ''}
        </div>
      </div>
    </article>
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
  const routeAssignment = getRouteAssignmentMap(savedRoutes);
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
        <h4>Scheduled stops for ${routeDay} preview (${date})</h4>
        <div class="route-stop-list">
          ${visits.length ? visits.map((visit) => renderVisitCheckbox(visit, customers, properties, routeAssignment, savedRoutes)).join('') : '<p>No scheduled visits found for this preview date.</p>'}
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
    const assignmentMap = getRouteAssignmentMap(state.routes || []);
    const selectedVisitIds = [...new Set(formData.getAll('visit_id'))].filter((visitId) => !assignmentMap.has(visitId));
    const routeDay = String(formData.get('route_day') || weekdayForDate(dateInput?.value || today())).trim();
    const routeName = String(formData.get('route_name') || '').trim();
    const assignedWorker = String(formData.get('assigned_worker') || '').trim();
    const routeDate = dateInput?.value || today();

    if (!routeName || selectedVisitIds.length === 0) return;

    const existingRoute = (state.routes || []).find((route) =>
      route.route_date === routeDate &&
      route.route_day === routeDay &&
      route.name === routeName &&
      (route.assigned_worker || '') === assignedWorker
    );
    const route = existingRoute || {
      route_id: makeRouteId(),
      company_id: state.company?.company_id,
      name: routeName,
      route_day: routeDay,
      route_date: routeDate,
      assigned_worker: assignedWorker,
      visit_ids: [],
      created_at: new Date().toISOString()
    };

    state.routes = existingRoute
      ? (state.routes || []).map((savedRoute) => savedRoute.route_id === route.route_id
        ? { ...savedRoute, visit_ids: [...new Set([...(savedRoute.visit_ids || []), ...selectedVisitIds])] }
        : savedRoute)
      : [...(state.routes || []), { ...route, visit_ids: selectedVisitIds }];

    const savedRoute = (state.routes || []).find((saved) => saved.route_id === route.route_id);
    selectedVisitIds.forEach((visitId) => updateVisitRoute(state, visitId, savedRoute));

    saveStateFn(state);
    render();
  });

  document.querySelectorAll('[data-route-remove-stop]').forEach((button) => {
    button.addEventListener('click', () => {
      const visitId = button.dataset.routeRemoveStop;
      state.routes = removeVisitFromRoutes(state.routes || [], visitId);
      updateVisitRoute(state, visitId, null);
      saveStateFn(state);
      render();
    });
  });

  document.querySelectorAll('[data-route-move-stop]').forEach((button) => {
    button.addEventListener('click', () => {
      const visitId = button.dataset.routeMoveStop;
      const targetSelect = document.querySelector(`[data-route-target="${visitId}"]`);
      const targetRouteId = targetSelect?.value;
      const targetRoute = (state.routes || []).find((route) => route.route_id === targetRouteId);
      if (!visitId || !targetRoute) return;

      state.routes = removeVisitFromRoutes(state.routes || [], visitId).map((route) => route.route_id === targetRoute.route_id
        ? { ...route, visit_ids: [...new Set([...(route.visit_ids || []), visitId])] }
        : route);
      const updatedTargetRoute = (state.routes || []).find((route) => route.route_id === targetRoute.route_id);
      updateVisitRoute(state, visitId, updatedTargetRoute);
      saveStateFn(state);
      render();
    });
  });
}
