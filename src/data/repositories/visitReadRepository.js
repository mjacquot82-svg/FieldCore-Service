import { readState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const today = () => new Date().toISOString().slice(0, 10);

function byVisitDate(a, b) {
  return String(a.visit_date || '').localeCompare(String(b.visit_date || ''));
}

export function getStateSnapshot() {
  return clone(readState());
}

export function listVisits() {
  return clone(readState().visits || []);
}

export function listProperties() {
  return clone(readState().properties || []);
}

export function getScheduledVisitsForProperty(propertyId) {
  return listVisits()
    .filter((visit) =>
      visit.property_id === propertyId
      && visit.status === 'scheduled'
      && visit.visit_date
    )
    .sort(byVisitDate);
}

export function getNextScheduledVisitForProperty(propertyId, referenceDate = today()) {
  return getScheduledVisitsForProperty(propertyId)
    .filter((visit) => visit.visit_date >= referenceDate)[0] || null;
}

export function hasUpcomingScheduledVisitForProperty(propertyId, referenceDate = today()) {
  return Boolean(getNextScheduledVisitForProperty(propertyId, referenceDate));
}

export function listVisitsForDate(visitDate) {
  return listVisits().filter((visit) => visit.visit_date === visitDate);
}

export function getRouteProgressForDate(visitDate) {
  const visits = listVisitsForDate(visitDate);

  return {
    total: visits.length,
    completed: visits.filter((visit) => visit.status === 'completed').length,
    skipped: visits.filter((visit) => visit.status === 'skipped').length,
    remaining: visits.filter((visit) => visit.status === 'scheduled').length
  };
}

export function getLateCompletedVisitLookup() {
  return new Set(
    listVisits()
      .filter((visit) => visit.status === 'completed' && visit.completed_late)
      .map((visit) => `${visit.visit_date}|${visit.service_description}`)
  );
}
