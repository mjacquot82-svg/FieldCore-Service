import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function findVisit(visits, visitId) {
  return visits.find((visit) => visit.visit_id === visitId);
}

function makeVisitId() {
  return `visit_${crypto.randomUUID().slice(0, 8)}`;
}

export function getVisit(visitId) {
  return cloneOrNull(findVisit(readState().visits || [], visitId));
}

export function listVisits() {
  return clone(readState().visits || []);
}

export function listVisitsByDate(visitDate) {
  return listVisits().filter((visit) => visit.visit_date === visitDate);
}

export function createVisit(visit, metadata = {}) {
  const state = readState();
  const nextVisit = clone(visit);

  const nextState = {
    ...state,
    visits: [...(state.visits || []), nextVisit]
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'visit:create',
    visit_id: nextVisit.visit_id
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'create',
    visit_id: nextVisit.visit_id,
    visit: clone(nextVisit),
    metadata: clone(metadata)
  });

  return clone(nextVisit);
}

export function scheduleVisit(visitInput = {}, metadata = {}) {
  return createVisit(
    {
      ...visitInput,
      visit_id: visitInput.visit_id || makeVisitId(),
      created_at: visitInput.created_at || new Date().toISOString()
    },
    {
      ...metadata,
      action: metadata.action || 'visit:schedule',
      eventAction: metadata.eventAction || 'schedule'
    }
  );
}

export function scheduleOneOffVisit(visitInput = {}, metadata = {}) {
  return scheduleVisit(visitInput, {
    ...metadata,
    action: metadata.action || 'visit:schedule-one-off',
    eventAction: metadata.eventAction || 'schedule-one-off'
  });
}

export function bulkCreateVisits(visits = [], metadata = {}) {
  if (!visits.length) return [];

  const state = readState();
  const nextVisits = visits.map((visit) => clone({
    ...visit,
    visit_id: visit.visit_id || makeVisitId(),
    created_at: visit.created_at || new Date().toISOString()
  }));

  const nextState = {
    ...state,
    visits: [...(state.visits || []), ...nextVisits]
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'visit:create-many',
    visit_ids: nextVisits.map((visit) => visit.visit_id)
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'create-many',
    visit_ids: nextVisits.map((visit) => visit.visit_id),
    visits: clone(nextVisits),
    metadata: clone(metadata)
  });

  return clone(nextVisits);
}

export function updateVisit(visitId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedVisit = null;

  const nextState = {
    ...state,
    visits: (state.visits || []).map((visit) => {
      if (visit.visit_id !== visitId) return visit;
      updatedVisit = {
        ...visit,
        ...patch
      };
      return updatedVisit;
    })
  };

  if (!updatedVisit) return null;

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'visit:update',
    visit_id: visitId
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'update',
    visit_id: visitId,
    visit: clone(updatedVisit),
    metadata: clone(metadata)
  });

  return clone(updatedVisit);
}

export function updateVisitStatus(visitId, status, patch = {}, metadata = {}) {
  return updateVisit(
    visitId,
    {
      ...patch,
      status
    },
    {
      ...metadata,
      action: metadata.action || 'visit:update-status',
      eventAction: metadata.eventAction || 'update-status',
      status
    }
  );
}

export function updateSkipReason(visitId, skipReason, metadata = {}) {
  return updateVisit(
    visitId,
    {
      skip_reason: skipReason,
      skipped_at: metadata.skipped_at || new Date().toISOString()
    },
    {
      ...metadata,
      action: metadata.action || 'visit:update-skip-reason',
      eventAction: metadata.eventAction || 'update-skip-reason'
    }
  );
}

export function updateCompletionMetadata(visitId, metadata = {}) {
  const existingVisit = getVisit(visitId);
  if (!existingVisit) return null;

  const completedDate = metadata.completed_date || new Date().toISOString().slice(0, 10);
  const completedAt = metadata.completed_at || new Date().toISOString();

  return updateVisit(
    visitId,
    {
      completed_at: existingVisit.completed_at || completedAt,
      completed_date: existingVisit.completed_date || completedDate,
      completed_late: Boolean(existingVisit.visit_date && existingVisit.visit_date < completedDate)
    },
    {
      ...metadata,
      action: metadata.action || 'visit:update-completion-metadata',
      eventAction: metadata.eventAction || 'update-completion-metadata'
    }
  );
}

export function assignVisitToRoute(visitId, route, metadata = {}) {
  if (!route) return null;

  return updateVisit(
    visitId,
    {
      route_id: route.route_id,
      route_name: route.name,
      route_day: route.route_day,
      assigned_worker: route.assigned_worker
    },
    {
      ...metadata,
      action: metadata.action || 'visit:assign-route',
      eventAction: metadata.eventAction || 'assign-route'
    }
  );
}

export function clearVisitRouteAssignment(visitId, metadata = {}) {
  const visit = getVisit(visitId);
  if (!visit) return null;

  return updateVisit(
    visitId,
    {
      route_id: undefined,
      route_name: undefined,
      route_day: undefined,
      assigned_worker: undefined
    },
    {
      ...metadata,
      action: metadata.action || 'visit:clear-route-assignment',
      eventAction: metadata.eventAction || 'clear-route-assignment'
    }
  );
}
