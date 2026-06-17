import { readState } from '../data/storage/local-state-adapter.js';
import {
  addStopsToRoute,
  createRoute,
  listRoutes,
  moveStopToRoute as moveStopToRouteRecord,
  removeStopFromRoute,
  reorderRouteStops as reorderRouteStopsRecord
} from '../data/repositories/routeRepository.js';
import {
  assignVisitToRoute,
  clearVisitRouteAssignment
} from '../data/repositories/visitRepository.js';

function findMatchingRoute(routes, routeInput) {
  return (routes || []).find((route) =>
    route.route_date === routeInput.route_date &&
    route.route_day === routeInput.route_day &&
    route.name === routeInput.name &&
    (route.assigned_worker || '') === (routeInput.assigned_worker || '')
  );
}

function removeVisitFromAllRoutes(visitId) {
  listRoutes().forEach((route) => {
    if ((route.visit_ids || []).includes(visitId)) {
      removeStopFromRoute(route.route_id, visitId, {
        action: 'route:remove-stop-for-move',
        eventAction: 'remove-stop-for-move'
      });
    }
  });
}

export function saveRouteWithStops(routeInput, visitIds = [], metadata = {}) {
  const existingRoute = findMatchingRoute(listRoutes(), routeInput);
  const route = existingRoute
    ? addStopsToRoute(existingRoute.route_id, visitIds, {
        ...metadata,
        action: 'route:update-stops',
        eventAction: 'update-stops'
      })
    : createRoute(
        {
          ...routeInput,
          visit_ids: visitIds
        },
        {
          ...metadata,
          action: 'route:create-with-stops',
          eventAction: 'create-with-stops'
        }
      );

  if (!route) return null;

  visitIds.forEach((visitId) => {
    assignVisitToRoute(visitId, route, {
      action: 'visit:assign-route-from-route-service',
      eventAction: 'assign-route-from-route-service',
      route_id: route.route_id
    });
  });

  return {
    route,
    state: readState()
  };
}

export function removeStopFromRoutes(visitId, metadata = {}) {
  removeVisitFromAllRoutes(visitId);
  clearVisitRouteAssignment(visitId, {
    ...metadata,
    action: 'visit:clear-route-from-route-service',
    eventAction: 'clear-route-from-route-service'
  });

  return readState();
}

export function moveStopToRoute(routeId, visitId, metadata = {}) {
  removeVisitFromAllRoutes(visitId);
  const route = moveStopToRouteRecord(routeId, visitId, {
    ...metadata,
    action: 'route:move-stop-to-route',
    eventAction: 'move-stop-to-route'
  });

  if (route) {
    assignVisitToRoute(visitId, route, {
      action: 'visit:assign-route-from-move',
      eventAction: 'assign-route-from-move',
      route_id: route.route_id
    });
  }

  return readState();
}

export function reorderRouteStops(visitId, direction, metadata = {}) {
  reorderRouteStopsRecord(visitId, direction, metadata);
  return readState();
}
