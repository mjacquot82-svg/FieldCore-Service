const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const EMPLOYEES_VIEW_ID = 'employees';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeEmployeeId() {
  return `emp_${crypto.randomUUID().slice(0, 8)}`;
}

function addEmployeesNav() {
  document.querySelectorAll('nav').forEach((nav) => {
    if (nav.querySelector(`[data-enhanced-nav="${EMPLOYEES_VIEW_ID}"]`)) return;

    const button = document.createElement('button');
    button.className = 'nav-btn';
    button.dataset.enhancedNav = EMPLOYEES_VIEW_ID;
    button.textContent = 'Employees';
    nav.appendChild(button);
  });
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

function renderEmployees() {
  const state = loadState();
  if (!state) return;

  const main = document.querySelector('main.content');
  if (!main) return;

  const employees = state.employees || [];

  main.innerHTML = `
    <section>
      <h2>Employees</h2>
      <form id="employee-form" class="panel service-form">
        <h3>Add Employee</h3>
        <label>Name
          <input name="name" placeholder="Employee name" required />
        </label>
        <label>Role
          <input name="role" placeholder="Worker, crew lead, admin" value="Worker" />
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

  bindEmployeeEvents();
}

function bindEmployeeEvents() {
  const form = document.querySelector('#employee-form');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
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

      const employee = {
        employee_id: makeEmployeeId(),
        company_id: state.company?.company_id,
        name,
        role,
        pin,
        status: 'active',
        created_at: new Date().toISOString()
      };

      state.employees = [...(state.employees || []), employee];
      saveState(state);
      renderEmployees();
    });
  }

  document.querySelectorAll('[data-employee-toggle]').forEach((button) => {
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
      renderEmployees();
    });
  });

  document.querySelectorAll('[data-employee-pin]').forEach((button) => {
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
      renderEmployees();
    });
  });
}

function setActiveEmployeesButton() {
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
  document.querySelectorAll(`[data-enhanced-nav="${EMPLOYEES_VIEW_ID}"]`).forEach((button) => button.classList.add('active'));
}

document.addEventListener('click', (event) => {
  const employeesButton = event.target.closest(`[data-enhanced-nav="${EMPLOYEES_VIEW_ID}"]`);
  if (!employeesButton) return;

  event.preventDefault();
  setActiveEmployeesButton();
  renderEmployees();
});

const observer = new MutationObserver(addEmployeesNav);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addEmployeesNav();
