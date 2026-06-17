import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeRouteId() {
  return `route_${crypto.randomUUID().slice(0, 8)}`;
}

function emitRouteChanged(eventName, payload) {
  emit('routes:changed', payload);
  emit(eventName, payload);
}

export function listRoutes() {
  return clone(readState().routes || []);
}

export function listRoutesByDate(routeDate) {
  return listRoutes().filter((route) => route.route_date === routeDate);
}

export function getRoute(routeId) {
  const route = (readState().routes || []).find((item) => item.route_id === routeId);
  return cloneOrNull(route);
}

export function createRoute(routeInput = {}, metadata = {}) {
  const state = readState();
  const route = {
    route_id: routeInput.route_id || makeRouteId(),
    company_id: routeInput.company_id || state.company?.company_id,
    name: routeInput.name,
    route_day: routeInput.route_day,
    route_date: routeInput.route_date,
    assigned_worker: routeInput.assigned_worker,
    visit_ids: routeInput.visit_ids || [],
    created_at: routeInput.created_at || new Date().toISOString()
  };

  const nextState = {
    ...state,
    routes: [...(state.routes || []), route]
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'route:create',
    route_id: route.route_id
  });

  emitRouteChanged('route:created', {
    action: metadata.eventAction || 'create',
    route_id: route.route_id,
    route: clone(route),
    metadata: clone(metadata)
  });

  return clone(route);
}

export function updateRoute(routeId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedRoute = null;

  const nextState = {
    ...state,
    routes: (state.routes || []).map((route) => {
      if (route.route_id !== routeId) return route;
      updatedRoute = {
        ...route,
        ...patch
      };
      return updatedRoute;
    })
  };

  if (!updatedRoute) return null;

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'route:update',
    route_id: routeId
  });

  emitRouteChanged('route:updated', {
    action: metadata.eventAction || metadata.action || 'update',
    route_id: routeId,
    route: clone(updatedRoute),
    metadata: clone(metadata)
  });

  return clone(updatedRoute);
}

export function deleteRoute(routeId, metadata = {}) {
  const state = readState();
  const route = (state.routes || []).find((item) => item.route_id === routeId);
  if (!route) return null;

  const nextState = {
    ...state,
    routes: (state.routes || []).filter((item) => item.route_id !== routeId)
  };

  writeState(nextState, {
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

export function addStopsToRoute(routeId, visitIds = [], metadata = {}) {
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

export function removeStopFromRoute(routeId, visitId, metadata = {}) {
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
