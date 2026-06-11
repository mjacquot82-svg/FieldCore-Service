import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeShiftId() {
  return crypto.randomUUID();
}

export function listShifts() {
  return clone(readState().shifts || []);
}

export function getActiveShift(employeeId) {
  const shift = (readState().shifts || []).find(
    (item) => item.employee_id === employeeId && !item.ended_at
  );
  return cloneOrNull(shift);
}

export function startShift(employeeId, metadata = {}) {
  const state = readState();
  const shifts = state.shifts || [];
  const activeShift = shifts.find((shift) => shift.employee_id === employeeId && !shift.ended_at);

  if (activeShift) return clone(activeShift);

  const shift = {
    shift_id: makeShiftId(),
    employee_id: employeeId,
    employee_name: metadata.employee_name || metadata.employeeName || '',
    started_at: new Date().toISOString()
  };

  const nextState = {
    ...state,
    shifts: [...shifts, shift]
  };

  writeState(nextState, {
    action: 'shift:start',
    employee_id: employeeId
  });

  emit('shifts:changed', {
    action: 'start',
    employee_id: employeeId,
    shift: clone(shift)
  });

  return clone(shift);
}

export function endShift(employeeId, metadata = {}) {
  const state = readState();
  const shifts = state.shifts || [];
  let endedShift = null;

  const nextState = {
    ...state,
    shifts: shifts.map((shift) => {
      if (endedShift || shift.employee_id !== employeeId || shift.ended_at) return shift;
      endedShift = {
        ...shift,
        ended_at: metadata.ended_at || new Date().toISOString()
      };
      return endedShift;
    })
  };

  if (!endedShift) return null;

  writeState(nextState, {
    action: 'shift:end',
    employee_id: employeeId,
    shift_id: endedShift.shift_id
  });

  emit('shifts:changed', {
    action: 'end',
    employee_id: employeeId,
    shift: clone(endedShift)
  });

  return clone(endedShift);
}
