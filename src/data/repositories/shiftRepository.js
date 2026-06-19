import { emit } from '../appEventBus.js';
import { canUseLocalPersistenceFallback, requireRemoteResult } from '../appMode.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const SHIFT_FIELDS = [
  'shift_id',
  'company_id',
  'employee_id',
  'employee_name',
  'started_at',
  'ended_at',
  'created_at',
  'updated_at'
];

const SHIFT_SELECT_FIELDS = SHIFT_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeShiftId() {
  return crypto.randomUUID();
}

function localShifts() {
  return readState().shifts || [];
}

function writeLocalShifts(shifts, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    shifts
  };

  writeState(nextState, metadata);
  return shifts;
}

function normalizeShiftForSupabase(shift) {
  return SHIFT_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(shift, field)) {
      record[field] = shift[field] ?? null;
    }
    return record;
  }, {
    shift_id: shift.shift_id,
    company_id: shift.company_id,
    employee_id: shift.employee_id,
    employee_name: shift.employee_name || null,
    started_at: shift.started_at,
    ended_at: shift.ended_at || null
  });
}

async function readSupabaseShifts(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('shifts', {
    select: SHIFT_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'started_at.desc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function readSupabaseActiveShift(employeeId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId || !employeeId) return null;

  const response = await supabaseSelect('shifts', {
    select: SHIFT_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    employee_id: `eq.${employeeId}`,
    ended_at: 'is.null',
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseShift(shift) {
  const record = normalizeShiftForSupabase(shift);
  if (!record.shift_id || !record.company_id || !record.employee_id || !record.started_at) return null;

  const response = await supabaseUpsert('shifts', record, {
    onConflict: 'shift_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseShifts(shifts) {
  const records = shifts.map(normalizeShiftForSupabase).filter((shift) => (
    shift.shift_id && shift.company_id && shift.employee_id && shift.started_at
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('shifts', records, {
    onConflict: 'shift_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

export async function syncShiftsFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const shifts = await readSupabaseShifts(companyId);
  if (!shifts) return null;

  if (!shifts.length && canUseLocalPersistenceFallback() && (state.shifts || []).length) {
    const bootstrappedShifts = await writeSupabaseShifts(state.shifts || []);
    if (!bootstrappedShifts) return null;

    writeLocalShifts(bootstrappedShifts, {
      action: 'shifts:bootstrap-supabase'
    });

    return clone(bootstrappedShifts);
  }

  writeLocalShifts(shifts, {
    action: 'shifts:sync-from-supabase'
  });

  return clone(shifts);
}

export function listShifts() {
  return clone(localShifts());
}

export async function listShiftsAsync() {
  const shifts = await readSupabaseShifts(await resolveRepositoryCompanyId());
  return requireRemoteResult(shifts, 'Production shift read failed.') || listShifts();
}

export function getActiveShift(employeeId) {
  const shift = localShifts().find(
    (item) => item.employee_id === employeeId && !item.ended_at
  );
  return cloneOrNull(shift);
}

export async function getActiveShiftAsync(employeeId) {
  const shift = await readSupabaseActiveShift(employeeId);
  return shift || getActiveShift(employeeId);
}

export async function startShift(employeeId, metadata = {}) {
  const state = readState();
  const shifts = state.shifts || [];
  const activeShift = shifts.find((shift) => shift.employee_id === employeeId && !shift.ended_at);

  if (activeShift) return clone(activeShift);

  const remoteActiveShift = await readSupabaseActiveShift(employeeId);
  if (remoteActiveShift) {
    writeLocalShifts([...shifts, remoteActiveShift], {
      action: 'shift:sync-active',
      employee_id: employeeId,
      shift_id: remoteActiveShift.shift_id
    });
    return clone(remoteActiveShift);
  }

  const shift = {
    shift_id: makeShiftId(),
    company_id: metadata.company_id || await resolveRepositoryCompanyId(),
    employee_id: employeeId,
    employee_name: metadata.employee_name || metadata.employeeName || '',
    started_at: metadata.started_at || new Date().toISOString()
  };

  const persistedShift = requireRemoteResult(
    await writeSupabaseShift(shift),
    'Production shift start failed.'
  ) || shift;

  writeLocalShifts([...shifts, persistedShift], {
    ...metadata,
    action: metadata.action || 'shift:start',
    employee_id: employeeId,
    shift_id: persistedShift.shift_id
  });

  emit('shifts:changed', {
    action: 'start',
    employee_id: employeeId,
    shift: clone(persistedShift)
  });

  return clone(persistedShift);
}

export async function endShift(employeeId, metadata = {}) {
  const state = readState();
  const shifts = state.shifts || [];
  let endedShift = null;

  const nextShifts = shifts.map((shift) => {
    if (endedShift || shift.employee_id !== employeeId || shift.ended_at) return shift;
    endedShift = {
      ...shift,
      ended_at: metadata.ended_at || new Date().toISOString()
    };
    return endedShift;
  });

  if (!endedShift) return null;
  const persistedShift = requireRemoteResult(
    await writeSupabaseShift(endedShift),
    'Production shift end failed.'
  ) || endedShift;
  const persistedShifts = nextShifts.map((shift) => (
    shift.shift_id === persistedShift.shift_id ? persistedShift : shift
  ));

  writeLocalShifts(persistedShifts, {
    ...metadata,
    action: metadata.action || 'shift:end',
    employee_id: employeeId,
    shift_id: persistedShift.shift_id
  });

  emit('shifts:changed', {
    action: 'end',
    employee_id: employeeId,
    shift: clone(persistedShift)
  });

  return clone(persistedShift);
}
