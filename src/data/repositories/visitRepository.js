import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function findVisit(visits, visitId) {
  return visits.find((visit) => visit.visit_id === visitId);
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
