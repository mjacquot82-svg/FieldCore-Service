import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const DEFAULT_ADMIN_PIN = '0000';
const clone = (value) => JSON.parse(JSON.stringify(value));

export function getSettings() {
  return clone(readState().settings || {});
}

export function getAdminPin() {
  return getSettings().admin_pin || DEFAULT_ADMIN_PIN;
}

export function ensureDefaultAdminPin() {
  const state = readState();
  if (state.settings?.admin_pin) return clone(state.settings);

  const settings = {
    ...(state.settings || {}),
    admin_pin: DEFAULT_ADMIN_PIN
  };

  const nextState = {
    ...state,
    settings
  };

  writeState(nextState, {
    action: 'settings:ensure-default-admin-pin'
  });

  emit('settings:changed', {
    action: 'ensure-default-admin-pin',
    settings: clone(settings)
  });

  return clone(settings);
}

export function updatePayrollWeekStart(payrollWeekStart) {
  const state = readState();
  const settings = {
    ...(state.settings || {}),
    payroll_week_start: payrollWeekStart
  };

  const nextState = {
    ...state,
    settings
  };

  writeState(nextState, {
    action: 'settings:update-payroll-week-start',
    payroll_week_start: payrollWeekStart
  });

  emit('settings:changed', {
    action: 'update-payroll-week-start',
    payroll_week_start: payrollWeekStart,
    settings: clone(settings)
  });

  return clone(settings);
}
