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

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function getAdminPin(state) {
  return state?.settings?.admin_pin || DEFAULT_ADMIN_PIN;
}

function ensureDefaultAdminPin(state) {
  if (!state) return;
  if (state.settings?.admin_pin) return;
  state.settings = { ...(state.settings || {}), admin_pin: DEFAULT_ADMIN_PIN };
  saveState(state);
}

function activeEmployees(state) {
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

function renderLogin() {
  const app = document.querySelector('#app');
  if (!app) return;
  app.innerHTML = loginCard();
  bindLoginEvents();
}

function bindLoginEvents() {
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
        role: 'employee',
        employee_id: employee.employee_id,
        name: employee.name,
        started_at: new Date().toISOString()
      });
      window.location.reload();
    });
  }
}

function addLogoutControl(session) {
  const main = document.querySelector('main.content');
  if (!main || main.querySelector('[data-session-banner]')) return;

  const banner = document.createElement('div');
  banner.className = 'flash session-banner';
  banner.setAttribute('data-session-banner', 'true');
  banner.innerHTML = `Logged in as <strong>${session.name}</strong> (${session.role}) <button data-logout class="primary">Logout</button>`;
  main.prepend(banner);

  banner.querySelector('[data-logout]')?.addEventListener('click', () => {
    clearSession();
    window.location.reload();
  });
}

function restrictEmployeeNav() {
  const allowedLabels = new Set(['Today’s Route']);
  document.querySelectorAll('.nav-btn').forEach((button) => {
    const label = button.textContent.trim();
    const isAllowed = allowedLabels.has(label);
    button.hidden = !isAllowed;
  });
}

function openEmployeeRoute(session) {
  const routeButton = [...document.querySelectorAll('.nav-btn')]
    .find((button) => button.textContent.trim() === 'Today’s Route');

  const heading = document.querySelector('section h2')?.textContent.trim();
  if (routeButton && heading !== 'Today’s Route / Daily Work List' && heading !== 'Overdue Visits') {
    routeButton.click();
  }

  setTimeout(() => {
    const workerFilter = document.querySelector('#worker-route-filter');
    if (workerFilter) {
      workerFilter.value = session.name;
      workerFilter.dispatchEvent(new Event('change', { bubbles: true }));
      workerFilter.closest('label')?.setAttribute('hidden', 'true');
    }
  }, 50);
}

function applySessionRules() {
  const session = getSession();
  if (!session) {
    renderLogin();
    return;
  }

  addLogoutControl(session);

  if (session.role === 'employee') {
    restrictEmployeeNav();
    openEmployeeRoute(session);
  }
}

const session = getSession();
if (!session) {
  document.addEventListener('DOMContentLoaded', renderLogin);
} else {
  const observer = new MutationObserver(applySessionRules);
  observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
  applySessionRules();
}
