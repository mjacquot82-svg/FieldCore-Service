import { emit } from '../appEventBus.js';
import { canUseLocalPersistenceFallback, requireRemoteResult } from '../appMode.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseDelete, supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const ROUTE_STOP_FIELDS = [
  'route_stop_id',
  'company_id',
  'route_id',
  'visit_id',
  'stop_order',
  'created_at',
  'updated_at'
];

const ROUTE_STOP_SELECT_FIELDS = ROUTE_STOP_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeRouteStopId(routeId, visitId) {
  return `rs_${routeId}_${visitId}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

function localRouteStops() {
  return readState().route_stops || [];
}

function writeLocalRouteStops(routeStops, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    route_stops: routeStops
  };

  writeState(nextState, metadata);
  return routeStops;
}

function projectRouteStopsOntoRoutes(routeStops, metadata = {}) {
  const state = readState();
  const stopsByRoute = routeStops.reduce((groups, routeStop) => {
    if (!groups[routeStop.route_id]) groups[routeStop.route_id] = [];
    groups[routeStop.route_id].push(routeStop);
    groups[routeStop.route_id].sort((a, b) => Number(a.stop_order || 0) - Number(b.stop_order || 0));
    return groups;
  }, {});

  const routes = (state.routes || []).map((route) => (
    stopsByRoute[route.route_id]
      ? {
          ...route,
          visit_ids: stopsByRoute[route.route_id].map((routeStop) => routeStop.visit_id)
        }
      : route
  ));

  writeState({
    ...state,
    routes
  }, {
    ...metadata,
    action: metadata.action || 'route-stops:project-routes'
  });
}

function normalizeRouteStopForSupabase(routeStop) {
  return ROUTE_STOP_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(routeStop, field)) {
      record[field] = routeStop[field] ?? null;
    }
    return record;
  }, {
    route_stop_id: routeStop.route_stop_id,
    company_id: routeStop.company_id,
    route_id: routeStop.route_id,
    visit_id: routeStop.visit_id,
    stop_order: Number(routeStop.stop_order ?? 0)
  });
}

async function readSupabaseRouteStops(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('route_stops', {
    select: ROUTE_STOP_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'stop_order.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function writeSupabaseRouteStops(routeStops) {
  const records = routeStops.map(normalizeRouteStopForSupabase).filter((routeStop) => (
    routeStop.route_stop_id && routeStop.company_id && routeStop.route_id && routeStop.visit_id
  ));
  if (!records.length) return [];

  const response = await supabaseUpsert('route_stops', records, {
    onConflict: 'route_stop_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function deleteSupabaseRouteStopForVisit(routeId, visitId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId || !routeId || !visitId) return null;

  const response = await supabaseDelete('route_stops', {
    company_id: `eq.${companyId}`,
    route_id: `eq.${routeId}`,
    visit_id: `eq.${visitId}`
  });

  if (!response.configured || response.error) return null;
  return true;
}

export async function syncRouteStopsFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const routeStops = await readSupabaseRouteStops(companyId);
  if (!routeStops) return null;

  if (!routeStops.length && canUseLocalPersistenceFallback() && (state.route_stops || []).length) {
    const bootstrappedRouteStops = await writeSupabaseRouteStops(state.route_stops || []);
    if (!bootstrappedRouteStops) return null;

    writeLocalRouteStops(bootstrappedRouteStops, {
      action: 'route-stops:bootstrap-supabase'
    });
    projectRouteStopsOntoRoutes(bootstrappedRouteStops, {
      action: 'route-stops:project-routes-after-bootstrap'
    });

    return clone(bootstrappedRouteStops);
  }

  writeLocalRouteStops(routeStops, {
    action: 'route-stops:sync-from-supabase'
  });
  projectRouteStopsOntoRoutes(routeStops, {
    action: 'route-stops:project-routes-from-supabase'
  });

  return clone(routeStops);
}

export function listRouteStops() {
  return clone(localRouteStops());
}

export async function listRouteStopsAsync() {
  const routeStops = await readSupabaseRouteStops(await resolveRepositoryCompanyId());
  return requireRemoteResult(routeStops, 'Production route stop read failed.') || listRouteStops();
}

export async function upsertRouteStopsForRoute(route, metadata = {}) {
  if (!route?.route_id || !route.company_id) return [];

  const visitIds = route.visit_ids || [];
  const routeStops = visitIds.map((visitId, index) => ({
    route_stop_id: makeRouteStopId(route.route_id, visitId),
    company_id: route.company_id,
    route_id: route.route_id,
    visit_id: visitId,
    stop_order: index
  }));

  const persistedRouteStops = requireRemoteResult(
    await writeSupabaseRouteStops(routeStops),
    'Production route stop write failed.'
  ) || routeStops;

  const existingRouteStops = localRouteStops().filter((routeStop) => routeStop.route_id !== route.route_id);
  writeLocalRouteStops([...existingRouteStops, ...persistedRouteStops], {
    ...metadata,
    action: metadata.action || 'route-stops:upsert-for-route',
    route_id: route.route_id,
    visit_ids: visitIds
  });
  projectRouteStopsOntoRoutes([...existingRouteStops, ...persistedRouteStops], {
    ...metadata,
    action: 'route-stops:project-routes-after-upsert'
  });

  emit('route-stops:changed', {
    action: metadata.eventAction || metadata.action || 'upsert-for-route',
    route_id: route.route_id,
    route_stops: clone(persistedRouteStops),
    metadata: clone(metadata)
  });

  return clone(persistedRouteStops);
}

export async function deleteRouteStopForVisit(routeId, visitId, metadata = {}) {
  requireRemoteResult(
    await deleteSupabaseRouteStopForVisit(routeId, visitId),
    'Production route stop delete failed.'
  );

  const nextRouteStops = localRouteStops().filter((routeStop) => !(
    routeStop.route_id === routeId && routeStop.visit_id === visitId
  ));

  writeLocalRouteStops(nextRouteStops, {
    ...metadata,
    action: metadata.action || 'route-stops:delete-for-visit',
    route_id: routeId,
    visit_id: visitId
  });
  projectRouteStopsOntoRoutes(nextRouteStops, {
    ...metadata,
    action: 'route-stops:project-routes-after-delete'
  });

  emit('route-stops:changed', {
    action: metadata.eventAction || metadata.action || 'delete-for-visit',
    route_id: routeId,
    visit_id: visitId,
    metadata: clone(metadata)
  });

  return true;
}
