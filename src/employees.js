import { loadState, saveState } from './lib/store.js';

function makeEmployeeId() {
  return `emp_${crypto.randomUUID().slice(0, 8)}`;
}

function syncEmployeeView(render) {
  if (typeof render === 'function') {
    render();
    return;
  }

  const main = document.querySelector('main.content');
  if (main) {
    main.innerHTML = renderEmployees();
    bindEmployeeEvents(render);
  }
}

function employeeCard(employee) {
  return `
    <article class="panel employee-card">
      <div class="customer-card-header">
        <div>
          <h3>${employee.name}</h3>
          <p>${employee.role || 'Worker'} · PIN ${employee.pin}</p>
        </div>
        <span class="badge ${employee.status === 'active' ? 'paid-up' : 'outstanding'}">${employee.status}</span>
      </div>
      <div class="actions">
        <button data-employee-toggle="${employee.employee_id}">${employee.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
        <button data-employee-pin="${employee.employee_id}">Change PIN</button>
      </div>
    </article>
  `;
}

export function renderEmployees() {
  const state = loadState();
  if (!state) return '<section><p>Employees data not available.</p></section>';

  const employees = state.employees || [];

  return `
    <section>
      <h2>Employees</h2>
      <form id="employee-form" class="panel service-form">
        <h3>Add Employee</h3>
        <label>Name
          <input name="name" placeholder="Employee name" required />
        </label>
        <label>Role
          <select name="role">
            <option value="Worker" selected>Worker</option>
            <option value="Owner/Admin">Owner/Admin</option>
          </select>
        </label>
        <label>4-digit PIN
          <input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" required />
        </label>
        <button class="primary" type="submit">Add Employee</button>
      </form>

      <h3>Active Employees</h3>
      <div class="stack">
        ${employees.length ? employees.map(employeeCard).join('') : '<article class="panel"><p>No employees added yet.</p></article>'}
      </div>
    </section>
  `;
}

export function bindEmployeeEvents(render) {
  const form = document.querySelector('#employee-form');
  if (form && form.dataset.employeeBound !== 'true') {
    form.dataset.employeeBound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.dataset.employeeSubmitting === 'true') return;

      const state = loadState();
      if (!state) return;

      const formData = new FormData(form);
      const name = String(formData.get('name') || '').trim();
      const role = String(formData.get('role') || 'Worker').trim() || 'Worker';
      const pin = String(formData.get('pin') || '').trim();

      if (!name || !/^\d{4}$/.test(pin)) {
        window.alert('Employee PIN must be exactly 4 digits.');
        return;
      }

      form.dataset.employeeSubmitting = 'true';
      const employee = {
        employee_id: makeEmployeeId(),
        company_id: state.company?.company_id,
        name,
        role,
        pin,
        status: 'active',
        created_at: new Date().toISOString()
      };

      const employees = state.employees || [];
      if (employees.some((item) => item.employee_id === employee.employee_id)) {
        form.dataset.employeeSubmitting = 'false';
        return;
      }

      state.employees = [...employees, employee];
      saveState(state);
      loadState();
      form.reset();
      syncEmployeeView(render);
    });
  }

  document.querySelectorAll('[data-employee-toggle]').forEach((button) => {
    if (button.dataset.employeeBound === 'true') return;
    button.dataset.employeeBound = 'true';
    button.addEventListener('click', () => {
      const state = loadState();
      if (!state) return;

      const employeeId = button.dataset.employeeToggle;
      state.employees = (state.employees || []).map((employee) =>
        employee.employee_id === employeeId
          ? { ...employee, status: employee.status === 'active' ? 'inactive' : 'active' }
          : employee
      );

      saveState(state);
      loadState();
      syncEmployeeView(render);
    });
  });

  document.querySelectorAll('[data-employee-pin]').forEach((button) => {
    if (button.dataset.employeeBound === 'true') return;
    button.dataset.employeeBound = 'true';
    button.addEventListener('click', () => {
      const state = loadState();
      if (!state) return;

      const employeeId = button.dataset.employeePin;
      const nextPin = window.prompt('Enter new 4-digit PIN:');
      if (nextPin === null) return;
      if (!/^\d{4}$/.test(nextPin.trim())) {
        window.alert('PIN must be exactly 4 digits.');
        return;
      }

      state.employees = (state.employees || []).map((employee) =>
        employee.employee_id === employeeId ? { ...employee, pin: nextPin.trim() } : employee
      );

      saveState(state);
      loadState();
      syncEmployeeView(render);
    });
  });
}
