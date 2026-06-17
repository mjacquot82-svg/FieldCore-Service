import {
  listActiveEmployees,
  updateEmployeePin
} from '../data/repositories/employeeRepository.js';
import {
  ensureDefaultAdminPin,
  getSettings,
  updateAdminPin
} from '../data/repositories/settingsRepository.js';
import { verifyPin } from '../data/pinHash.js';

const DEFAULT_ADMIN_PIN = '0000';

function normalizePin(pin) {
  return String(pin || '').trim();
}

function activeEmployeesFromState(state) {
  return state ? (state.employees || []).filter((employee) => employee.status === 'active') : listActiveEmployees();
}

export async function verifyEmployeePin(employeeId, pin, state = null) {
  const normalizedPin = normalizePin(pin);
  const employee = activeEmployeesFromState(state).find((item) => item.employee_id === employeeId);
  if (!employee) return null;

  if (employee.pin_hash && await verifyPin(normalizedPin, employee.pin_hash)) {
    return employee;
  }

  if (employee.pin && employee.pin === normalizedPin) {
    await updateEmployeePin(employee.employee_id, normalizedPin);
    return {
      ...employee,
      pin: null
    };
  }

  return null;
}

export async function verifyAdminPin(pin, state = null) {
  const normalizedPin = normalizePin(pin);
  const settings = state?.settings || getSettings();

  if (settings?.admin_pin_hash && await verifyPin(normalizedPin, settings.admin_pin_hash)) {
    return true;
  }

  if (settings?.admin_pin && settings.admin_pin === normalizedPin) {
    await updateAdminPin(normalizedPin, {
      action: 'settings:migrate-admin-pin-login'
    });
    return true;
  }

  if (!settings?.admin_pin && !settings?.admin_pin_hash && normalizedPin === DEFAULT_ADMIN_PIN) {
    await ensureDefaultAdminPin();
    return true;
  }

  return false;
}
