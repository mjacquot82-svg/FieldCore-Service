import { isProductionMode } from './data/appMode.js';
import { listActiveEmployees } from './data/repositories/employeeRepository.js';
import {
  ensureDefaultAdminPin as ensureDefaultAdminPinRecord
} from './data/repositories/settingsRepository.js';
import { validateRepositoryAuthContext } from './data/repositoryContext.js';
import {
  getAuthenticatedUser,
  signInWithPassword,
  signUpWithPassword,
  signOut
} from './data/supabaseAuth.js';
import { isSupabaseConfigured } from './data/supabaseClient.js';
import { createProductionOwnerCompany } from './services/companyOnboardingService.js';
import {
  verifyAdminPin,
  verifyEmployeePin
} from './services/pinVerificationService.js';
import {
  formatUserError,
  logOperationalError,
  logOperationalEvent
} from './services/operationalLogger.js';
import { escapeAttr, escapeHtml } from './utils/renderSecurity.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';

function loadState() {
  if (isProductionMode()) return null;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
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

export async function clearAuthenticatedSession() {
  clearSession();
  if (isProductionMode()) await signOut();
}

export async function ensureDefaultAdminPin(state) {
  if (!state) return;
  if (state.settings?.admin_pin || state.settings?.admin_pin_hash) return;
  await ensureDefaultAdminPinRecord();
}

export function activeEmployees(state) {
  return state ? (state.employees || []).filter((employee) => employee.status === 'active') : listActiveEmployees();
}

function productionAuthLoginCard(message = '') {
  return `
    <div class="login-shell">
      <section class="panel login-card">
        <h1>FieldCore Login</h1>
        <p>Production mode requires a Supabase account before company access or PIN shortcuts are available.</p>
        ${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}
        <form id="supabase-login-form" class="service-form">
          <h3>Sign In</h3>
          <label>Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="primary" type="submit">Login</button>
        </form>
        <form id="supabase-signup-form" class="service-form">
          <h3>Create Owner Account</h3>
          <label>Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="new-password" minlength="6" required />
          </label>
          <button class="primary" type="submit">Sign Up</button>
        </form>
      </section>
    </div>
  `;
}

function productionCreateCompanyCard(diagnostics, user) {
  const reason = !diagnostics.membershipActive
    ? 'No company is linked to this account yet.'
    : !diagnostics.membershipUserLinked
      ? 'The active company membership is not linked to this Supabase user.'
      : !diagnostics.companyResolved
        ? 'No company could be resolved for this Supabase user.'
        : 'This Supabase user is not ready for production access.';

  return `
    <div class="login-shell">
      <section class="panel login-card">
        <div class="flash session-banner">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
            <div>
              <strong>${escapeHtml(user?.email || user?.id || 'Supabase user')}</strong>
              <span style="color:#475569;font-size:0.95rem;">(no company)</span>
            </div>
            <button type="button" data-supabase-logout class="primary">Logout Supabase</button>
          </div>
        </div>
        <h1>Create Company</h1>
        <p>${escapeHtml(reason)} Create your company to continue into FieldCore.</p>
        <form id="company-onboarding-form" class="service-form">
          <h3>Company Setup</h3>
          <label>Company Name
            <input name="company_name" autocomplete="organization" required />
          </label>
          <label>Owner/Admin PIN
            <input name="admin_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="4 digits" required />
          </label>
          <label>Confirm PIN
            <input name="confirm_admin_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="4 digits" required />
          </label>
          <label>Invoice Prefix
            <input name="invoice_prefix" maxlength="8" value="FC" required />
          </label>
          <label>Default Due Days
            <input name="default_due_days" type="number" min="0" max="365" value="15" required />
          </label>
          <label>Tax Rate
            <input name="tax_rate" type="number" min="0" max="1" step="0.000001" value="0" required />
          </label>
          <label>Payroll Week Start
            <select name="payroll_week_start">
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </select>
          </label>
          <button class="primary" type="submit">Create Company</button>
        </form>
      </section>
    </div>
  `;
}

function productionMembershipBlockedCard(diagnostics) {
  const reason = !diagnostics.membershipActive
    ? 'No active company membership was found for this Supabase user.'
    : !diagnostics.membershipUserLinked
      ? 'The active company membership is not linked to this Supabase user.'
      : !diagnostics.companyResolved
        ? 'No company could be resolved for this Supabase user.'
        : 'This Supabase user is not ready for production access.';

  return `
    <div class="login-shell">
      <section class="panel login-card">
        <h1>FieldCore Login</h1>
        <p>${escapeHtml(reason)}</p>
        <p>User ID: ${escapeHtml(diagnostics.userId || 'unknown')}</p>
        <button class="primary" data-supabase-logout>Logout</button>
      </section>
    </div>
  `;
}

function productionSessionSummary(diagnostics, user) {
  if (!isProductionMode()) return '';
  return `
    <div class="flash session-banner">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
        <div>
          <strong>${escapeHtml(user?.email || user?.id || 'Supabase user')}</strong>
          <span style="color:#475569;font-size:0.95rem;">(${escapeHtml(diagnostics.role || 'member')})</span>
        </div>
        <button type="button" data-supabase-logout class="primary">Logout Supabase</button>
      </div>
    </div>
  `;
}

function filterEmployeesForProductionMembership(employees, diagnostics) {
  if (!isProductionMode() || diagnostics.role !== 'employee') return employees;
  if (!diagnostics.employeeId) return [];
  return employees.filter((employee) => employee.employee_id === diagnostics.employeeId);
}

async function loginCard() {
  const diagnostics = isProductionMode() ? await validateRepositoryAuthContext() : null;

  if (isProductionMode()) {
    if (!isSupabaseConfigured()) return productionAuthLoginCard('Supabase is not configured.');
    if (!diagnostics.authenticated || !diagnostics.transportAuthenticated) return productionAuthLoginCard();
    const user = await getAuthenticatedUser();
    if (!diagnostics.membershipActive && diagnostics.userId) return productionCreateCompanyCard(diagnostics, user);
    if (!diagnostics.ready) return productionMembershipBlockedCard(diagnostics);
  }

  const state = loadState();
  await ensureDefaultAdminPin(state);
  const user = isProductionMode() ? await getAuthenticatedUser() : null;
  const employees = filterEmployeesForProductionMembership(activeEmployees(state), diagnostics || {});
  const canUseAdminPin = !isProductionMode() || ['owner', 'admin', 'manager'].includes(diagnostics?.role);
  const canUseEmployeePin = !isProductionMode() || diagnostics?.role === 'employee';

  return `
    <div class="login-shell">
      <section class="panel login-card">
        <h1>FieldCore Login</h1>
        <p>Owners/admins get full access. Employees use their PIN to see assigned route work.</p>
        ${productionSessionSummary(diagnostics || {}, user)}

        ${canUseAdminPin ? `<form id="admin-login-form" class="service-form">
          <h3>Owner / Admin</h3>
          <label>Admin PIN
            <input name="admin_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="0000" required />
          </label>
          <button class="primary" type="submit">Login as Admin</button>
        </form>` : ''}

        ${canUseEmployeePin ? `<form id="employee-login-form" class="service-form worker-login-form">
          <h3>Employee</h3>
          <label>Employee
            <select name="employee_id" required>
              <option value="">Select employee</option>
              ${employees.map((employee) => `<option value="${escapeAttr(employee.employee_id)}">${escapeHtml(employee.name)}</option>`).join('')}
            </select>
          </label>
          <label>Employee PIN
            <input name="employee_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" required />
          </label>
          <button class="primary" type="submit" ${employees.length ? '' : 'disabled'}>Login as Employee</button>
          ${employees.length ? '' : '<p>Add employees from the Employees screen after logging in as admin.</p>'}
        </form>` : ''}
      </section>
    </div>
  `;
}

export function renderLogin() {
  const app = document.querySelector('#app');
  if (!app) return;
  loginCard().then((html) => {
    app.innerHTML = html;
    bindLoginEvents();
  });
}

export function bindLoginEvents() {
  const supabaseForm = document.querySelector('#supabase-login-form');
  if (supabaseForm) {
    supabaseForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(supabaseForm);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');
      const result = await signInWithPassword(email, password);

      if (!result.session) {
        window.alert(formatUserError(result.error, 'Sign in failed. Check your email and password and try again.'));
        return;
      }

      window.location.reload();
    });
  }

  const supabaseSignupForm = document.querySelector('#supabase-signup-form');
  if (supabaseSignupForm) {
    supabaseSignupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(supabaseSignupForm);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');
      const result = await signUpWithPassword(email, password);

      if (result.error) {
        window.alert(formatUserError(result.error, 'Sign up failed. Check your email and password and try again.'));
        return;
      }

      if (!result.session) {
        window.alert('Check your email to confirm your account, then sign in.');
        return;
      }

      window.location.reload();
    });
  }

  document.querySelectorAll('[data-supabase-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      await clearAuthenticatedSession();
      window.location.reload();
    });
  });

  const onboardingForm = document.querySelector('#company-onboarding-form');
  if (onboardingForm) {
    onboardingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = onboardingForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      const formData = new FormData(onboardingForm);

      try {
        await createProductionOwnerCompany({
          companyName: formData.get('company_name'),
          adminPin: formData.get('admin_pin'),
          confirmAdminPin: formData.get('confirm_admin_pin'),
          invoicePrefix: formData.get('invoice_prefix'),
          defaultDueDays: formData.get('default_due_days'),
          taxRate: formData.get('tax_rate'),
          payrollWeekStart: formData.get('payroll_week_start')
        });
        clearSession();
        window.location.reload();
      } catch (error) {
        logOperationalError(
          'onboarding',
          'company-onboarding-submit-failed',
          error,
          {},
          'Company setup could not be completed.'
        );
        window.alert(formatUserError(error, 'Company setup could not be completed. Please try again or contact support.'));
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  const adminForm = document.querySelector('#admin-login-form');
  if (adminForm) {
    adminForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const state = loadState();
      const formData = new FormData(adminForm);
      const pin = String(formData.get('admin_pin') || '').trim();

      if (!await verifyAdminPin(pin, state)) {
        window.alert('Invalid admin PIN.');
        return;
      }

      const diagnostics = isProductionMode() ? await validateRepositoryAuthContext() : null;
      if (isProductionMode() && !diagnostics.ready) {
        logOperationalEvent({
          category: 'membership',
          severity: 'warning',
          action: 'admin-pin-membership-blocked',
          message: 'Admin PIN accepted but production membership was not ready.',
          userMessage: 'Your company access could not be verified.',
          details: diagnostics
        });
        window.alert('Your company access could not be verified.');
        return;
      }

      setSession({
        role: 'admin',
        name: 'Owner/Admin',
        started_at: new Date().toISOString(),
        auth_user_id: diagnostics?.userId || null,
        membership_id: diagnostics?.membershipId || null,
        membership_role: diagnostics?.role || null,
        company_id: diagnostics?.companyId || null
      });
      window.location.reload();
    });
  }

  const employeeForm = document.querySelector('#employee-login-form');
  if (employeeForm) {
    employeeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const state = loadState();
      const formData = new FormData(employeeForm);
      const employeeId = String(formData.get('employee_id') || '').trim();
      const pin = String(formData.get('employee_pin') || '').trim();
      const employee = await verifyEmployeePin(employeeId, pin, state);

      if (!employee) {
        window.alert('Invalid employee or PIN.');
        return;
      }

      const diagnostics = isProductionMode() ? await validateRepositoryAuthContext() : null;
      if (isProductionMode() && (!diagnostics.ready || diagnostics.employeeId !== employee.employee_id)) {
        logOperationalEvent({
          category: 'membership',
          severity: 'warning',
          action: 'employee-pin-membership-blocked',
          message: 'Employee PIN accepted but production employee membership was not ready.',
          userMessage: 'Your employee access could not be verified.',
          details: {
            ...diagnostics,
            selectedEmployeeId: employee.employee_id
          }
        });
        window.alert('Your employee access could not be verified.');
        return;
      }

      setSession({
        role: 'worker',
        employee_id: employee.employee_id,
        name: employee.name,
        started_at: new Date().toISOString(),
        auth_user_id: diagnostics?.userId || null,
        membership_id: diagnostics?.membershipId || null,
        membership_role: diagnostics?.role || null,
        company_id: diagnostics?.companyId || null
      });
      window.location.reload();
    });
  }
}
