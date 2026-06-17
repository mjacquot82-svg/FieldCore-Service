import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeEmployeeId() {
  return `emp_${crypto.randomUUID().slice(0, 8)}`;
}

export function listEmployees() {
  return clone(readState().employees || []);
}

export function listActiveEmployees() {
  return listEmployees().filter((employee) => employee.status === 'active');
}

export function getEmployee(employeeId) {
  const employee = (readState().employees || []).find((item) => item.employee_id === employeeId);
  return cloneOrNull(employee);
}

export function createEmployee(employeeInput = {}) {
  const state = readState();
  const employee = {
    employee_id: employeeInput.employee_id || makeEmployeeId(),
    company_id: employeeInput.company_id || state.company?.company_id,
    name: employeeInput.name || '',
    role: employeeInput.role || 'Worker',
    pin: employeeInput.pin || '',
    status: employeeInput.status || 'active',
    created_at: employeeInput.created_at || new Date().toISOString()
  };

  const employees = state.employees || [];
  if (employees.some((item) => item.employee_id === employee.employee_id)) return null;

  const nextState = {
    ...state,
    employees: [...employees, employee]
  };

  writeState(nextState, {
    action: 'employee:create',
    employee_id: employee.employee_id
  });

  emit('employees:changed', {
    action: 'create',
    employee_id: employee.employee_id,
    employee: clone(employee)
  });

  return clone(employee);
}

export function toggleEmployeeStatus(employeeId) {
  const state = readState();
  let updatedEmployee = null;

  const nextState = {
    ...state,
    employees: (state.employees || []).map((employee) => {
      if (employee.employee_id !== employeeId) return employee;
      updatedEmployee = {
        ...employee,
        status: employee.status === 'active' ? 'inactive' : 'active'
      };
      return updatedEmployee;
    })
  };

  if (!updatedEmployee) return null;

  writeState(nextState, {
    action: 'employee:toggle-status',
    employee_id: employeeId,
    status: updatedEmployee.status
  });

  emit('employees:changed', {
    action: 'toggle-status',
    employee_id: employeeId,
    employee: clone(updatedEmployee)
  });

  return clone(updatedEmployee);
}

export function updateEmployeePin(employeeId, pin) {
  const state = readState();
  let updatedEmployee = null;

  const nextState = {
    ...state,
    employees: (state.employees || []).map((employee) => {
      if (employee.employee_id !== employeeId) return employee;
      updatedEmployee = {
        ...employee,
        pin
      };
      return updatedEmployee;
    })
  };

  if (!updatedEmployee) return null;

  writeState(nextState, {
    action: 'employee:update-pin',
    employee_id: employeeId
  });

  emit('employees:changed', {
    action: 'update-pin',
    employee_id: employeeId,
    employee: clone(updatedEmployee)
  });

  return clone(updatedEmployee);
}

export function deleteEmployee(employeeId) {
  const state = readState();
  const employee = (state.employees || []).find((item) => item.employee_id === employeeId);
  if (!employee) return null;

  const nextState = {
    ...state,
    employees: (state.employees || []).filter((item) => item.employee_id !== employeeId)
  };

  writeState(nextState, {
    action: 'employee:delete',
    employee_id: employeeId
  });

  emit('employees:changed', {
    action: 'delete',
    employee_id: employeeId,
    employee: clone(employee)
  });

  return clone(employee);
}
