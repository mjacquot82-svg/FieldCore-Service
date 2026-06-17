import { emit } from '../appEventBus.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseDelete, supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const ROUTE_FIELDS = [
  'route_id',
  'company_id',
  'name',
  'route_day',
  'route_date',
  'assigned_worker',
  'employee_id',
  'visit_ids',
  'created_at',
  'updated_at'
];

const ROUTE_SELECT_FIELDS = ROUTE_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeRouteId() {
  return `route_${crypto.randomUUID().slice(0, 8)}`;
}

function localRoutes() {
  return readState().routes || [];
}

function writeLocalRoutes(routes, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    routes
  };

  writeState(nextState, metadata);
  return routes;
}

function emitRouteChanged(eventName, payload) {
  emit('routes:changed', payload);
  emit(eventName, payload);
}

function normalizeRouteFromSupabase(route) {
  if (!route) return null;
  return {
    ...route,
    visit_ids: Array.isArray(route.visit_ids) ? route.visit_ids : []
  };
}

function normalizeRouteForSupabase(route) {
  return ROUTE_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(route, field)) {
      record[field] = route[field] ?? null;
    }
    return record;
  }, {
    route_id: route.route_id,
    company_id: route.company_id,
    name: route.name || '',
    route_day: route.route_day || 'Monday',
    route_date: route.route_date,
    assigned_worker: route.assigned_worker || null,
    visit_ids: Array.isArray(route.visit_ids) ? route.visit_ids : []
  });
}

async function readSupabaseRoutes(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('routes', {
    select: ROUTE_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'route_date.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizeRouteFromSupabase));
}

async function readSupabaseRoute(routeId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId) return null;

  const response = await supabaseSelect('routes', {
    select: ROUTE_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    route_id: `eq.${routeId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(normalizeRouteFromSupabase(response.data[0]));
}

async function writeSupabaseRoute(route) {
  const record = normalizeRouteForSupabase(route);
  if (!record.route_id || !record.company_id || !record.route_date) return null;

  const response = await supabaseUpsert('routes', record, {
    onConflict: 'route_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(normalizeRouteFromSupabase(response.data[0]));
}

async function writeSupabaseRoutes(routes) {
  const records = routes.map(normalizeRouteForSupabase).filter((route) => (
    route.route_id && route.company_id && route.route_date
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('routes', records, {
    onConflict: 'route_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizeRouteFromSupabase));
}

async function deleteSupabaseRoute(routeId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId) return null;

  const response = await supabaseDelete('routes', {
    company_id: `eq.${companyId}`,
    route_id: `eq.${routeId}`
  });

  if (!response.configured || response.error) return null;
  return true;
}

export async function syncRoutesFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const routes = await readSupabaseRoutes(companyId);
  if (!routes) return null;

  if (!routes.length && (state.routes || []).length) {
    const bootstrappedRoutes = await writeSupabaseRoutes(state.routes || []);
    if (!bootstrappedRoutes) return null;

    writeLocalRoutes(bootstrappedRoutes, {
      action: 'routes:bootstrap-supabase'
    });

    return clone(bootstrappedRoutes);
  }

  writeLocalRoutes(routes, {
    action: 'routes:sync-from-supabase'
  });

  return clone(routes);
}

export function listRoutes() {
  return clone(localRoutes());
}

export async function listRoutesAsync() {
  const routes = await readSupabaseRoutes(await resolveRepositoryCompanyId());
  return routes || listRoutes();
}

export function listRoutesByDate(routeDate) {
  return listRoutes().filter((route) => route.route_date === routeDate);
}

export async function listRoutesByDateAsync(routeDate) {
  const routes = await listRoutesAsync();
  return routes.filter((route) => route.route_date === routeDate);
}

export function getRoute(routeId) {
  const route = localRoutes().find((item) => item.route_id === routeId);
  return cloneOrNull(route);
}

export async function getRouteAsync(routeId) {
  const route = await readSupabaseRoute(routeId);
  return route || getRoute(routeId);
}

export async function createRoute(routeInput = {}, metadata = {}) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const route = {
    route_id: routeInput.route_id || makeRouteId(),
    company_id: routeInput.company_id || companyId,
    name: routeInput.name,
    route_day: routeInput.route_day,
    route_date: routeInput.route_date,
    assigned_worker: routeInput.assigned_worker,
    employee_id: routeInput.employee_id,
    visit_ids: routeInput.visit_ids || [],
    created_at: routeInput.created_at || new Date().toISOString()
  };

  const persistedRoute = (await writeSupabaseRoute(route)) || route;
  writeLocalRoutes([...(state.routes || []), persistedRoute], {
    ...metadata,
    action: metadata.action || 'route:create',
    route_id: persistedRoute.route_id
  });

  emitRouteChanged('route:created', {
    action: metadata.eventAction || 'create',
    route_id: persistedRoute.route_id,
    route: clone(persistedRoute),
    metadata: clone(metadata)
  });

  return clone(persistedRoute);
}

export async function updateRoute(routeId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedRoute = null;

  const routes = state.routes || [];
  const nextRoutes = routes.map((route) => {
    if (route.route_id !== routeId) return route;
    updatedRoute = {
      ...route,
      ...patch
    };
    return updatedRoute;
  });

  if (!updatedRoute) return null;
  const persistedRoute = (await writeSupabaseRoute(updatedRoute)) || updatedRoute;
  const persistedRoutes = nextRoutes.map((route) => (
    route.route_id === routeId ? persistedRoute : route
  ));

  writeLocalRoutes(persistedRoutes, {
    ...metadata,
    action: metadata.action || 'route:update',
    route_id: routeId
  });

  emitRouteChanged('route:updated', {
    action: metadata.eventAction || metadata.action || 'update',
    route_id: routeId,
    route: clone(persistedRoute),
    metadata: clone(metadata)
  });

  return clone(persistedRoute);
}

export async function deleteRoute(routeId, metadata = {}) {
  const state = readState();
  const route = (state.routes || []).find((item) => item.route_id === routeId);
  if (!route) return null;

  await deleteSupabaseRoute(routeId);
  writeLocalRoutes((state.routes || []).filter((item) => item.route_id !== routeId), {
    ...metadata,
    action: metadata.action || 'route:delete',
    route_id: routeId
  });

  emitRouteChanged('route:deleted', {
    action: metadata.eventAction || 'delete',
    route_id: routeId,
    route: clone(route),
    metadata: clone(metadata)
  });

  return clone(route);
}

export async function addStopsToRoute(routeId, visitIds = [], metadata = {}) {
  const route = getRoute(routeId);
  if (!route) return null;

  return updateRoute(
    routeId,
    { visit_ids: [...new Set([...(route.visit_ids || []), ...visitIds])] },
    {
      ...metadata,
      action: metadata.action || 'route:add-stops',
      eventAction: metadata.eventAction || 'add-stops',
      visit_ids: visitIds
    }
  );
}

export async function removeStopFromRoute(routeId, visitId, metadata = {}) {
  const route = getRoute(routeId);
  if (!route) return null;

  return updateRoute(
    routeId,
    { visit_ids: (route.visit_ids || []).filter((id) => id !== visitId) },
    {
      ...metadata,
      action: metadata.action || 'route:remove-stop',
      eventAction: metadata.eventAction || 'remove-stop',
      visit_id: visitId
    }
  );
}

export function moveStopToRoute(routeId, visitId, metadata = {}) {
  return addStopsToRoute(routeId, [visitId], {
    ...metadata,
    action: metadata.action || 'route:move-stop',
    eventAction: metadata.eventAction || 'move-stop',
    visit_id: visitId
  });
}

export function reorderRouteStops(visitId, direction, metadata = {}) {
  const state = readState();
  const visits = [...(state.visits || [])];
  const index = visits.findIndex((visit) => visit.visit_id === visitId);
  if (index === -1) return null;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= visits.length) return null;

  const temp = visits[index];
  visits[index] = visits[swapIndex];
  visits[swapIndex] = temp;

  const nextState = {
    ...state,
    visits
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'route:reorder-stops',
    visit_id: visitId,
    direction
  });

  emitRouteChanged('route:reordered', {
    action: metadata.eventAction || 'reorder-stops',
    visit_id: visitId,
    direction,
    metadata: clone(metadata)
  });

  return clone(visits);
}

export function assignWorkerToRoute(routeId, assignedWorker, metadata = {}) {
  return updateRoute(
    routeId,
    { assigned_worker: assignedWorker },
    {
      ...metadata,
      action: metadata.action || 'route:assign-worker',
      eventAction: metadata.eventAction || 'assign-worker',
      assigned_worker: assignedWorker
    }
  );
}
