import { emit } from '../data/appEventBus.js';
import {
  getVisit,
  scheduleVisit,
  updateCompletionMetadata,
  updateVisitStatus
} from '../data/repositories/visitRepository.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function makeVisitId() {
  return `visit_${crypto.randomUUID().slice(0, 8)}`;
}

function emitLifecycleEvent(eventName, visit, metadata) {
  emit(eventName, {
    visit_id: visit.visit_id,
    visit,
    metadata
  });
}

export function startVisit(visitId, metadata = {}) {
  const startedAt = metadata.started_at || nowIso();
  const visit = updateVisitStatus(
    visitId,
    'in-progress',
    { started_at: startedAt },
    {
      ...metadata,
      action: metadata.action || 'visit:lifecycle-start',
      eventAction: metadata.eventAction || 'lifecycle-start'
    }
  );

  if (!visit) return null;

  emitLifecycleEvent('visit:started', visit, metadata);
  return visit;
}

export function completeVisit(visitId, metadata = {}) {
  const existingVisit = getVisit(visitId);
  if (!existingVisit) return null;

  const visit = updateVisitStatus(
    visitId,
    'completed',
    {},
    {
      ...metadata,
      action: metadata.action || 'visit:lifecycle-complete',
      eventAction: metadata.eventAction || 'lifecycle-complete'
    }
  );

  if (!visit) return null;

  const completedVisit = updateCompletionMetadata(visitId, {
    ...metadata,
    completed_at: metadata.completed_at || nowIso(),
    completed_date: metadata.completed_date || today(),
    action: 'visit:lifecycle-completion-metadata',
    eventAction: 'lifecycle-completion-metadata'
  }) || visit;

  emitLifecycleEvent('visit:completed', completedVisit, metadata);
  return completedVisit;
}

export function skipVisit(visitId, metadata = {}) {
  const skippedAt = metadata.skipped_at || nowIso();
  const skipPatch = { skipped_at: skippedAt };

  if (Object.prototype.hasOwnProperty.call(metadata, 'rescheduled_to')) {
    skipPatch.rescheduled_to = metadata.rescheduled_to;
  }

  const visit = updateVisitStatus(
    visitId,
    'skipped',
    skipPatch,
    {
      ...metadata,
      action: metadata.action || 'visit:lifecycle-skip',
      eventAction: metadata.eventAction || 'lifecycle-skip'
    }
  );

  if (!visit) return null;

  emitLifecycleEvent('visit:skipped', visit, metadata);
  return visit;
}

export function skipAndRescheduleVisit(visitId, nextDate, metadata = {}) {
  const existingVisit = getVisit(visitId);
  if (!existingVisit || !nextDate) return null;

  const skippedVisit = skipVisit(visitId, {
    ...metadata,
    rescheduled_to: nextDate
  });
  if (!skippedVisit) return null;

  const replacementVisit = {
    ...existingVisit,
    visit_id: makeVisitId(),
    visit_date: nextDate,
    status: 'scheduled',
    notes: existingVisit.notes || 'Rescheduled visit',
    created_at: metadata.created_at || nowIso()
  };

  delete replacementVisit.started_at;
  delete replacementVisit.completed_at;
  delete replacementVisit.completed_date;
  delete replacementVisit.completed_late;
  delete replacementVisit.skipped_at;
  delete replacementVisit.rescheduled_to;

  const newVisit = scheduleVisit(replacementVisit, {
    ...metadata,
    action: metadata.createAction || 'visit:lifecycle-reschedule-create',
    eventAction: metadata.createEventAction || 'lifecycle-reschedule-create',
    original_visit_id: visitId,
    rescheduled_to: nextDate
  });

  emit('visit:rescheduled', {
    visit_id: visitId,
    original_visit_id: visitId,
    replacement_visit_id: newVisit.visit_id,
    visit: skippedVisit,
    replacement_visit: newVisit,
    nextDate,
    metadata
  });

  return {
    skippedVisit,
    newVisit
  };
}
