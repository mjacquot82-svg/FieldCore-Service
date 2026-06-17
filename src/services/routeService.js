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

async function removeVisitFromAllRoutes(visitId) {
  for (const route of listRoutes()) {
    if ((route.visit_ids || []).includes(visitId)) {
      await removeStopFromRoute(route.route_id, visitId, {
        action: 'route:remove-stop-for-move',
        eventAction: 'remove-stop-for-move'
      });
    }
  }
}

export async function saveRouteWithStops(routeInput, visitIds = [], metadata = {}) {
  const existingRoute = findMatchingRoute(listRoutes(), routeInput);
  const route = existingRoute
    ? await addStopsToRoute(existingRoute.route_id, visitIds, {
        ...metadata,
        action: 'route:update-stops',
        eventAction: 'update-stops'
      })
    : await createRoute(
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

  for (const visitId of visitIds) {
    await assignVisitToRoute(visitId, route, {
      action: 'visit:assign-route-from-route-service',
      eventAction: 'assign-route-from-route-service',
      route_id: route.route_id
    });
  }

  return {
    route,
    state: readState()
  };
}

export async function removeStopFromRoutes(visitId, metadata = {}) {
  await removeVisitFromAllRoutes(visitId);
  await clearVisitRouteAssignment(visitId, {
    ...metadata,
    action: 'visit:clear-route-from-route-service',
    eventAction: 'clear-route-from-route-service'
  });

  return readState();
}

export async function moveStopToRoute(routeId, visitId, metadata = {}) {
  await removeVisitFromAllRoutes(visitId);
  const route = await moveStopToRouteRecord(routeId, visitId, {
    ...metadata,
    action: 'route:move-stop-to-route',
    eventAction: 'move-stop-to-route'
  });

  if (route) {
    await assignVisitToRoute(visitId, route, {
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
