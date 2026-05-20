const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';
const DEFAULT_ADMIN_PIN = '0000';

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

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function getAdminPin(state) {
  return state?.settings?.admin_pin || DEFAULT_ADMIN_PIN;
}

export function ensureDefaultAdminPin(state) {
  if (!state) return;
  if (state.settings?.admin_pin) return;
  state.settings = { ...(state.settings || {}), admin_pin: DEFAULT_ADMIN_PIN };
  saveState(state);
}

export function activeEmployees(state) {
  return (state?.employees || []).filter((employee) => employee.status === 'active');
}

function loginCard() {
  const state = loadState();
  ensureDefaultAdminPin(state);
  const employees = activeEmployees(state);

  return `
    <div class="login-shell">
      <section class="panel login-card">
        <h1>FieldCore Login</h1>
        <p>Owners/admins get full access. Employees use their PIN to see assigned route work.</p>

        <form id="admin-login-form" class="service-form">
          <h3>Owner / Admin</h3>
          <label>Admin PIN
            <input name="admin_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="0000" required />
          </label>
          <button class="primary" type="submit">Login as Admin</button>
        </form>

        <form id="employee-login-form" class="service-form worker-login-form">
          <h3>Employee</h3>
          <label>Employee
            <select name="employee_id" required>
              <option value="">Select employee</option>
              ${employees.map((employee) => `<option value="${employee.employee_id}">${employee.name}</option>`).join('')}
            </select>
          </label>
          <label>Employee PIN
            <input name="employee_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" required />
          </label>
          <button class="primary" type="submit" ${employees.length ? '' : 'disabled'}>Login as Employee</button>
          ${employees.length ? '' : '<p>Add employees from the Employees screen after logging in as admin.</p>'}
        </form>
      </section>
    </div>
  `;
}

export function renderLogin() {
  const app = document.querySelector('#app');
  if (!app) return;
  app.innerHTML = loginCard();
  bindLoginEvents();
}

export function bindLoginEvents() {
  const adminForm = document.querySelector('#admin-login-form');
  if (adminForm) {
    adminForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const state = loadState();
      const formData = new FormData(adminForm);
      const pin = String(formData.get('admin_pin') || '').trim();

      if (pin !== getAdminPin(state)) {
        window.alert('Invalid admin PIN.');
        return;
      }

      setSession({ role: 'admin', name: 'Owner/Admin', started_at: new Date().toISOString() });
      window.location.reload();
    });
  }

  const employeeForm = document.querySelector('#employee-login-form');
  if (employeeForm) {
    employeeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const state = loadState();
      const formData = new FormData(employeeForm);
      const employeeId = String(formData.get('employee_id') || '').trim();
      const pin = String(formData.get('employee_pin') || '').trim();
      const employee = activeEmployees(state).find((item) => item.employee_id === employeeId);

      if (!employee || employee.pin !== pin) {
        window.alert('Invalid employee or PIN.');
        return;
      }

      setSession({
        role: 'worker',
        employee_id: employee.employee_id,
        name: employee.name,
        started_at: new Date().toISOString()
      });
      window.location.reload();
    });
  }
}
