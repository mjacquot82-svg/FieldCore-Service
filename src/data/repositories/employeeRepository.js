import { emit } from '../appEventBus.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseDelete, supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const EMPLOYEE_SELECT_FIELDS = [
  'employee_id',
  'company_id',
  'name',
  'role',
  'pin',
  'status',
  'created_at',
  'updated_at'
].join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeEmployeeId() {
  return `emp_${crypto.randomUUID().slice(0, 8)}`;
}

function localEmployees() {
  return readState().employees || [];
}

function writeLocalEmployees(employees, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    employees
  };

  writeState(nextState, metadata);
  return employees;
}

async function ensureSupabaseCompany(state, companyId = state.company?.company_id) {
  const company = state.company;
  if (!companyId) return false;

  const response = await supabaseUpsert(
    'companies',
    {
      company_id: companyId,
      name: company.name || 'FieldCore',
      status: company.status || 'active',
      created_at: company.created_at
    },
    { onConflict: 'company_id' }
  );

  return response.configured && !response.error;
}

function normalizeEmployeeForSupabase(employee) {
  return {
    employee_id: employee.employee_id,
    company_id: employee.company_id,
    name: employee.name || '',
    role: employee.role || 'Worker',
    pin: employee.pin || '',
    status: employee.status || 'active',
    created_at: employee.created_at
  };
}

async function readSupabaseEmployees(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('employees', {
    select: EMPLOYEE_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'name.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function writeSupabaseEmployee(employee) {
  const state = readState();
  const record = normalizeEmployeeForSupabase(employee);
  if (!record.employee_id || !record.company_id) return null;

  const companyReady = await ensureSupabaseCompany(state, record.company_id);
  if (!companyReady) return null;

  const response = await supabaseUpsert('employees', record, {
    onConflict: 'employee_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseEmployees(employees) {
  const state = readState();
  const records = employees.map(normalizeEmployeeForSupabase).filter((employee) => (
    employee.employee_id && employee.company_id
  ));
  if (!records.length) return null;

  const companyReady = await ensureSupabaseCompany(state);
  if (!companyReady) return null;

  const response = await supabaseUpsert('employees', records, {
    onConflict: 'employee_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function deleteSupabaseEmployee(employeeId) {
  const response = await supabaseDelete('employees', {
    employee_id: `eq.${employeeId}`
  });

  if (!response.configured) return null;
  if (response.error) return null;
  return true;
}

export async function syncEmployeesFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const employees = await readSupabaseEmployees(companyId);
  if (!employees) return null;

  if (!employees.length && (state.employees || []).length) {
    const bootstrappedEmployees = await writeSupabaseEmployees(state.employees || []);
    if (!bootstrappedEmployees) return null;

    writeLocalEmployees(bootstrappedEmployees, {
      action: 'employees:bootstrap-supabase'
    });

    return clone(bootstrappedEmployees);
  }

  writeLocalEmployees(employees, {
    action: 'employees:sync-from-supabase'
  });

  return clone(employees);
}

export function listEmployees() {
  return clone(localEmployees());
}

export function listActiveEmployees() {
  return listEmployees().filter((employee) => employee.status === 'active');
}

export function getEmployee(employeeId) {
  const employee = localEmployees().find((item) => item.employee_id === employeeId);
  return cloneOrNull(employee);
}

export async function createEmployee(employeeInput = {}) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const employee = {
    employee_id: employeeInput.employee_id || makeEmployeeId(),
    company_id: employeeInput.company_id || companyId,
    name: employeeInput.name || '',
    role: employeeInput.role || 'Worker',
    pin: employeeInput.pin || '',
    status: employeeInput.status || 'active',
    created_at: employeeInput.created_at || new Date().toISOString()
  };

  const employees = state.employees || [];
  if (employees.some((item) => item.employee_id === employee.employee_id)) return null;

  const persistedEmployee = (await writeSupabaseEmployee(employee)) || employee;
  const nextEmployees = [...employees, persistedEmployee];

  writeLocalEmployees(nextEmployees, {
    action: 'employee:create',
    employee_id: persistedEmployee.employee_id
  });

  emit('employees:changed', {
    action: 'create',
    employee_id: persistedEmployee.employee_id,
    employee: clone(persistedEmployee)
  });

  return clone(persistedEmployee);
}

export async function toggleEmployeeStatus(employeeId) {
  const state = readState();
  let updatedEmployee = null;

  const employees = state.employees || [];
  const nextEmployees = employees.map((employee) => {
    if (employee.employee_id !== employeeId) return employee;
    updatedEmployee = {
      ...employee,
      status: employee.status === 'active' ? 'inactive' : 'active'
    };
    return updatedEmployee;
  });

  if (!updatedEmployee) return null;
  const persistedEmployee = (await writeSupabaseEmployee(updatedEmployee)) || updatedEmployee;
  const persistedEmployees = nextEmployees.map((employee) => (
    employee.employee_id === employeeId ? persistedEmployee : employee
  ));

  writeLocalEmployees(persistedEmployees, {
    action: 'employee:toggle-status',
    employee_id: employeeId,
    status: persistedEmployee.status
  });

  emit('employees:changed', {
    action: 'toggle-status',
    employee_id: employeeId,
    employee: clone(persistedEmployee)
  });

  return clone(persistedEmployee);
}

export async function updateEmployeePin(employeeId, pin) {
  const state = readState();
  let updatedEmployee = null;

  const employees = state.employees || [];
  const nextEmployees = employees.map((employee) => {
    if (employee.employee_id !== employeeId) return employee;
    updatedEmployee = {
      ...employee,
      pin
    };
    return updatedEmployee;
  });

  if (!updatedEmployee) return null;
  const persistedEmployee = (await writeSupabaseEmployee(updatedEmployee)) || updatedEmployee;
  const persistedEmployees = nextEmployees.map((employee) => (
    employee.employee_id === employeeId ? persistedEmployee : employee
  ));

  writeLocalEmployees(persistedEmployees, {
    action: 'employee:update-pin',
    employee_id: employeeId
  });

  emit('employees:changed', {
    action: 'update-pin',
    employee_id: employeeId,
    employee: clone(persistedEmployee)
  });

  return clone(persistedEmployee);
}

export async function deleteEmployee(employeeId) {
  const state = readState();
  const employee = (state.employees || []).find((item) => item.employee_id === employeeId);
  if (!employee) return null;

  await deleteSupabaseEmployee(employeeId);

  writeLocalEmployees((state.employees || []).filter((item) => item.employee_id !== employeeId), {
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
