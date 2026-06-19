import { emit } from '../appEventBus.js';
import { canUseLocalPersistenceFallback, requireRemoteResult } from '../appMode.js';
import { resolveRepositoryCompanyContext, resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const VISIT_FIELDS = [
  'visit_id',
  'company_id',
  'property_id',
  'visit_date',
  'service_description',
  'price',
  'status',
  'notes',
  'started_at',
  'route_id',
  'route_name',
  'route_day',
  'assigned_worker',
  'worker_name',
  'crew_name',
  'completed_at',
  'completed_date',
  'completed_late',
  'skip_reason',
  'skipped_at',
  'rescheduled_to',
  'recurring_generated',
  'holiday_conflict',
  'holiday_name',
  'created_at',
  'updated_at'
];

const VISIT_SELECT_FIELDS = VISIT_FIELDS.join(',');
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

function localVisits() {
  return readState().visits || [];
}

function writeLocalVisits(visits, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    visits
  };

  writeState(nextState, metadata);
  return visits;
}

function normalizeVisitFromSupabase(visit) {
  if (!visit) return null;
  return {
    ...visit,
    price: Number(visit.price ?? 0),
    completed_late: Boolean(visit.completed_late),
    recurring_generated: Boolean(visit.recurring_generated),
    holiday_conflict: Boolean(visit.holiday_conflict)
  };
}

function normalizeVisitForSupabase(visit) {
  return VISIT_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(visit, field)) {
      record[field] = visit[field] ?? null;
    }
    return record;
  }, {
    visit_id: visit.visit_id,
    company_id: visit.company_id,
    property_id: visit.property_id,
    visit_date: visit.visit_date,
    service_description: visit.service_description || '',
    price: Number(visit.price ?? 0),
    status: visit.status || 'scheduled',
    completed_late: Boolean(visit.completed_late),
    recurring_generated: Boolean(visit.recurring_generated),
    holiday_conflict: Boolean(visit.holiday_conflict)
  });
}

async function readSupabaseVisits(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('visits', {
    select: VISIT_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'visit_date.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizeVisitFromSupabase));
}

async function readSupabaseVisit(visitId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId) return null;

  const response = await supabaseSelect('visits', {
    select: VISIT_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    visit_id: `eq.${visitId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(normalizeVisitFromSupabase(response.data[0]));
}

async function writeSupabaseVisit(visit) {
  const record = normalizeVisitForSupabase(visit);
  if (!record.visit_id || !record.company_id || !record.property_id) return null;

  const response = await supabaseUpsert('visits', record, {
    onConflict: 'visit_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(normalizeVisitFromSupabase(response.data[0]));
}

async function writeSupabaseVisits(visits) {
  const records = visits.map(normalizeVisitForSupabase).filter((visit) => (
    visit.visit_id && visit.company_id && visit.property_id
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('visits', records, {
    onConflict: 'visit_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data.map(normalizeVisitFromSupabase));
}

export async function syncVisitsFromSupabase() {
  const state = readState();
  const context = await resolveRepositoryCompanyContext();
  const companyId = context?.companyId;
  const visits = await readSupabaseVisits(companyId);
  if (!visits) return null;

  if (!visits.length && canUseLocalPersistenceFallback() && context?.membership?.role !== 'employee' && (state.visits || []).length) {
    const bootstrappedVisits = await writeSupabaseVisits(state.visits || []);
    if (!bootstrappedVisits) return null;

    writeLocalVisits(bootstrappedVisits, {
      action: 'visits:bootstrap-supabase'
    });

    return clone(bootstrappedVisits);
  }

  writeLocalVisits(visits, {
    action: 'visits:sync-from-supabase'
  });

  return clone(visits);
}

export function getVisit(visitId) {
  return cloneOrNull(findVisit(localVisits(), visitId));
}

export async function getVisitAsync(visitId) {
  const visit = await readSupabaseVisit(visitId);
  return requireRemoteResult(visit, 'Production visit read failed.') || getVisit(visitId);
}

export function listVisits() {
  return clone(localVisits());
}

export async function listVisitsAsync() {
  const visits = await readSupabaseVisits(await resolveRepositoryCompanyId());
  return requireRemoteResult(visits, 'Production visit read failed.') || listVisits();
}

export function listVisitsByDate(visitDate) {
  return listVisits().filter((visit) => visit.visit_date === visitDate);
}

export async function createVisit(visit, metadata = {}) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const nextVisit = clone({
    ...visit,
    company_id: visit.company_id || companyId
  });

  const persistedVisit = requireRemoteResult(
    await writeSupabaseVisit(nextVisit),
    'Production visit create failed.'
  ) || nextVisit;
  writeLocalVisits([...(state.visits || []), persistedVisit], {
    ...metadata,
    action: metadata.action || 'visit:create',
    visit_id: persistedVisit.visit_id
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'create',
    visit_id: persistedVisit.visit_id,
    visit: clone(persistedVisit),
    metadata: clone(metadata)
  });

  return clone(persistedVisit);
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

export async function bulkCreateVisits(visits = [], metadata = {}) {
  if (!visits.length) return [];

  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const nextVisits = visits.map((visit) => clone({
    ...visit,
    company_id: visit.company_id || companyId,
    visit_id: visit.visit_id || makeVisitId(),
    created_at: visit.created_at || new Date().toISOString()
  }));

  const persistedVisits = requireRemoteResult(
    await writeSupabaseVisits(nextVisits),
    'Production bulk visit create failed.'
  ) || nextVisits;
  writeLocalVisits([...(state.visits || []), ...persistedVisits], {
    ...metadata,
    action: metadata.action || 'visit:create-many',
    visit_ids: persistedVisits.map((visit) => visit.visit_id)
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'create-many',
    visit_ids: persistedVisits.map((visit) => visit.visit_id),
    visits: clone(persistedVisits),
    metadata: clone(metadata)
  });

  return clone(persistedVisits);
}

export async function updateVisit(visitId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedVisit = null;

  const visits = state.visits || [];
  const nextVisits = visits.map((visit) => {
    if (visit.visit_id !== visitId) return visit;
    updatedVisit = {
      ...visit,
      ...patch
    };
    return updatedVisit;
  });

  if (!updatedVisit) return null;
  const persistedVisit = requireRemoteResult(
    await writeSupabaseVisit(updatedVisit),
    'Production visit update failed.'
  ) || updatedVisit;
  const persistedVisits = nextVisits.map((visit) => (
    visit.visit_id === visitId ? persistedVisit : visit
  ));

  writeLocalVisits(persistedVisits, {
    ...metadata,
    action: metadata.action || 'visit:update',
    visit_id: visitId
  });

  emit('visits:changed', {
    action: metadata.eventAction || metadata.action || 'update',
    visit_id: visitId,
    visit: clone(persistedVisit),
    metadata: clone(metadata)
  });

  return clone(persistedVisit);
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

export async function updateCompletionMetadata(visitId, metadata = {}) {
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
