import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

console.error = () => {};
console.warn = () => {};
console.info = () => {};

const APP_MODE_STORAGE_KEY = 'fieldcore_app_mode_v1';
const AUTH_SESSION_KEY = 'fieldcore_supabase_auth_session_v1';
const CONFIG_STORAGE_KEY = 'fieldcore_supabase_config_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';
const STATE_KEY = 'servicebatch_invoice_mvp_v1';
const LOG_STORAGE_KEY = 'fieldcore_operational_logs_v1';

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    }
  };
}

function installBrowserGlobals() {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.window = {
    FIELDCORE_APP_MODE: '',
    FIELDCORE_SUPABASE_CONFIG: null,
    addEventListener() {},
    dispatchEvent() {},
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    alert() {},
    open() {
      return null;
    }
  };
  globalThis.document = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true
  });
}

installBrowserGlobals();

function baseState() {
  return {
    company: {
      company_id: 'co_test',
      name: 'Regression Company',
      status: 'active'
    },
    settings: {
      invoice_prefix: 'REG',
      default_due_days: 15,
      tax_rate: 0,
      admin_pin: '0000'
    },
    company_memberships: [],
    employees: [
      {
        employee_id: 'emp_owner',
        company_id: 'co_test',
        name: 'Owner',
        role: 'Owner',
        status: 'active'
      },
      {
        employee_id: 'emp_worker',
        company_id: 'co_test',
        name: 'Worker',
        role: 'Worker',
        status: 'active'
      }
    ],
    customers: [],
    properties: [],
    visits: [],
    routes: [],
    route_stops: [],
    shifts: [],
    invoices: [],
    invoice_line_items: [],
    payments: [],
    activity_events: []
  };
}

function setMode(mode) {
  window.FIELDCORE_APP_MODE = mode;
  localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
}

function setState(state = baseState()) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function readState() {
  return JSON.parse(localStorage.getItem(STATE_KEY));
}

function reset({ mode = 'demo', state = baseState() } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  window.FIELDCORE_SUPABASE_CONFIG = null;
  setMode(mode);
  setState(state);
  globalThis.fetch = async () => jsonResponse({ message: 'Unexpected fetch' }, 500);
}

function configureProduction({
  user = { id: 'user_owner', email: 'owner@example.test' },
  membership = {
    membership_id: 'mbr_owner',
    company_id: 'co_test',
    user_id: 'user_owner',
    employee_id: 'emp_owner',
    role: 'owner',
    status: 'active'
  },
  handlers = {}
} = {}) {
  reset({ mode: 'production' });
  window.FIELDCORE_SUPABASE_CONFIG = {
    url: 'https://example.supabase.co',
    anonKey: 'anon-test',
    mode: 'production'
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(window.FIELDCORE_SUPABASE_CONFIG));
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user
  }));

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = {
      url: String(url),
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null
    };
    requests.push(request);

    if (handlers.fetch) {
      const handled = await handlers.fetch(request);
      if (handled) return handled;
    }

    if (request.url.includes('/auth/v1/user')) return jsonResponse(user);
    if (request.url.includes('/rest/v1/company_memberships')) {
      return jsonResponse(membership ? [membership] : []);
    }
    if (request.url.includes('/rest/v1/companies')) return jsonResponse([]);
    return jsonResponse([]);
  };

  return requests;
}

test('production mode fails closed unless demo or production is explicit', async () => {
  const appMode = await import('../src/data/appMode.js');

  localStorage.clear();
  window.FIELDCORE_APP_MODE = '';
  assert.equal(appMode.getAppMode(), 'invalid');
  assert.equal(appMode.canUseLocalPersistenceFallback(), false);
  assert.match(appMode.getAppModeRequirementMessage(), /explicit app mode/i);

  setMode('staging');
  assert.equal(appMode.getAppMode(), 'invalid');
  assert.equal(appMode.canUseLocalPersistenceFallback(), false);
  assert.match(appMode.getAppModeRequirementMessage(), /not valid/i);

  setMode('demo');
  assert.equal(appMode.getAppMode(), 'demo');
  assert.equal(appMode.canUseLocalPersistenceFallback(), true);

  setMode('production');
  assert.equal(appMode.getAppMode(), 'production');
  assert.equal(appMode.canUseLocalPersistenceFallback(), false);
});

test('production requires Supabase auth and active membership', async () => {
  const { validateRepositoryAuthContext } = await import('../src/data/repositoryContext.js');

  reset({ mode: 'production' });
  window.FIELDCORE_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'anon-test', mode: 'production' };
  globalThis.fetch = async () => jsonResponse([]);

  const unauthenticated = await validateRepositoryAuthContext();
  assert.equal(unauthenticated.authenticated, false);
  assert.equal(unauthenticated.ready, false);

  configureProduction({ membership: null });
  const missingMembership = await validateRepositoryAuthContext();
  assert.equal(missingMembership.authenticated, true);
  assert.equal(missingMembership.membershipActive, false);
  assert.equal(missingMembership.ready, false);

  configureProduction();
  const ready = await validateRepositoryAuthContext();
  assert.equal(ready.authenticated, true);
  assert.equal(ready.membershipActive, true);
  assert.equal(ready.companyResolved, true);
  assert.equal(ready.ready, true);
});

test('production sign-up stores returned Supabase session', async () => {
  reset({ mode: 'production' });
  window.FIELDCORE_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'anon-test', mode: 'production' };
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/auth\/v1\/signup$/);
    assert.equal(options.method, 'POST');
    return jsonResponse({
      access_token: 'signup-access-token',
      refresh_token: 'signup-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user_signup', email: 'new-owner@example.test' }
    });
  };
  const { signUpWithPassword, getCurrentAuthSession } = await import('../src/data/supabaseAuth.js');

  const result = await signUpWithPassword('new-owner@example.test', 'password-1');
  const session = await getCurrentAuthSession();

  assert.equal(result.session.access_token, 'signup-access-token');
  assert.equal(session.access_token, 'signup-access-token');
  assert.equal(session.user.id, 'user_signup');
});

test('production onboarding creates company owner membership and settings', async () => {
  const created = {
    company: null,
    membership: null,
    settings: null
  };
  const requests = configureProduction({
    user: { id: 'user_new_owner', email: 'owner-new@example.test' },
    membership: null,
    handlers: {
      fetch(request) {
        if (request.url.includes('/rest/v1/company_memberships')) {
          if (request.method === 'POST') {
            created.membership = request.body[0];
            return jsonResponse([created.membership]);
          }
          return jsonResponse(created.membership ? [created.membership] : []);
        }
        if (request.url.includes('/rest/v1/company_settings')) {
          created.settings = request.body[0];
          return jsonResponse([created.settings]);
        }
        if (request.url.includes('/rest/v1/companies')) {
          created.company = request.body[0];
          return jsonResponse([created.company]);
        }
        return null;
      }
    }
  });
  const { createProductionOwnerCompany } = await import('../src/services/companyOnboardingService.js');
  const { validateRepositoryAuthContext } = await import('../src/data/repositoryContext.js');
  const { verifyAdminPin } = await import('../src/services/pinVerificationService.js');
  const { restoreProductionAppSession } = await import('../src/role-pin-login.js');

  const result = await createProductionOwnerCompany({
    companyName: 'New Owner Lawn Care',
    adminPin: '2468',
    confirmAdminPin: '2468',
    invoicePrefix: 'NOL',
    defaultDueDays: 10,
    taxRate: 0.075,
    payrollWeekStart: 'monday'
  });
  const state = readState();

  assert.equal(result.company.name, 'New Owner Lawn Care');
  assert.equal(result.membership.user_id, 'user_new_owner');
  assert.equal(result.membership.role, 'owner');
  assert.equal(result.membership.status, 'active');
  assert.equal(result.settings.invoice_prefix, 'NOL');
  assert.equal(result.settings.default_due_days, 10);
  assert.equal(result.settings.tax_rate, 0.075);
  assert.equal(result.settings.payroll_week_start, 'monday');
  assert.equal(result.settings.admin_pin, null);
  assert.match(result.settings.admin_pin_hash, /^pbkdf2-sha256\$/);
  assert.equal(state.company.company_id, result.company.company_id);
  assert.equal(state.company_memberships[0].membership_id, result.membership.membership_id);
  assert.equal(state.settings.company_id, result.company.company_id);
  const diagnostics = await validateRepositoryAuthContext();
  assert.equal(diagnostics.ready, true);
  const restoredSession = await restoreProductionAppSession(diagnostics);
  const storedSession = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  assert.equal(restoredSession.membership_role, 'owner');
  assert.equal(restoredSession.company_id, result.company.company_id);
  assert.equal(storedSession.membership_id, result.membership.membership_id);
  assert.equal(await verifyAdminPin('2468'), true);
  assert.ok(requests.some((request) => request.method === 'POST' && request.url.includes('/rest/v1/companies')));
  assert.ok(requests.some((request) => request.method === 'POST' && request.url.includes('/rest/v1/company_memberships')));
  assert.ok(requests.some((request) => request.method === 'POST' && request.url.includes('/rest/v1/company_settings')));
});

test('production employee membership still requires employee PIN app session', async () => {
  configureProduction({
    user: { id: 'user_employee', email: 'employee@example.test' },
    membership: {
      membership_id: 'mbr_employee',
      company_id: 'co_test',
      user_id: 'user_employee',
      employee_id: 'emp_worker',
      role: 'employee',
      status: 'active'
    }
  });
  const { validateRepositoryAuthContext } = await import('../src/data/repositoryContext.js');
  const { restoreProductionAppSession } = await import('../src/role-pin-login.js');

  const diagnostics = await validateRepositoryAuthContext();
  const restoredSession = await restoreProductionAppSession(diagnostics);

  assert.equal(diagnostics.ready, true);
  assert.equal(diagnostics.role, 'employee');
  assert.equal(restoredSession, null);
  assert.equal(sessionStorage.getItem(SESSION_KEY), null);
});

test('role permission matrix protects financial and admin workflows', async () => {
  const { getUiPermissions } = await import('../src/services/uiPermissionService.js');

  reset({ mode: 'production' });
  const owner = getUiPermissions({ membership_role: 'owner' });
  const admin = getUiPermissions({ membership_role: 'admin' });
  const manager = getUiPermissions({ membership_role: 'manager' });
  const employee = getUiPermissions({ membership_role: 'employee' });

  assert.equal(owner.financials.createInvoices, true);
  assert.equal(admin.financials.recordPayments, true);
  assert.equal(owner.settings.operationalDiagnostics, true);
  assert.equal(manager.routes.assign, true);
  assert.equal(manager.financials.read, false);
  assert.equal(manager.financials.createInvoices, false);
  assert.equal(manager.financials.recordPayments, false);
  assert.equal(manager.financials.exportInvoices, false);
  assert.equal(manager.settings.operationalDiagnostics, false);
  assert.equal(employee.navigation['worker-route'], true);
  assert.equal(employee.navigation.customers, false);
  assert.equal(employee.financials.read, false);
});

test('customer and property create/update persist in explicit demo mode', async () => {
  reset({ mode: 'demo' });
  const {
    createCustomer,
    updateCustomer,
    getCustomer
  } = await import('../src/data/repositories/customerRepository.js');
  const {
    createProperty,
    updateProperty,
    getProperty
  } = await import('../src/data/repositories/propertyRepository.js');

  const customer = await createCustomer({
    customer_id: 'cust_regression',
    name: 'Initial Customer',
    email: 'initial@example.test'
  });
  assert.equal(customer.company_id, 'co_test');
  assert.equal(getCustomer('cust_regression').name, 'Initial Customer');

  await updateCustomer('cust_regression', { name: 'Updated Customer' });
  assert.equal(getCustomer('cust_regression').name, 'Updated Customer');

  const property = await createProperty({
    property_id: 'prop_regression',
    customer_id: 'cust_regression',
    service_address: '1 Regression Way',
    service_type: 'standard',
    recurring_frequency: 'one-time',
    default_price: 125
  });
  assert.equal(property.company_id, 'co_test');
  assert.equal(getProperty('prop_regression').service_address, '1 Regression Way');

  await updateProperty('prop_regression', { default_price: 150 });
  assert.equal(getProperty('prop_regression').default_price, 150);
});

test('visit completion and route assignment update persisted demo state', async () => {
  reset({
    mode: 'demo',
    state: {
      ...baseState(),
      customers: [{ customer_id: 'cust_route', company_id: 'co_test', name: 'Route Customer', status: 'active' }],
      properties: [{
        property_id: 'prop_route',
        company_id: 'co_test',
        customer_id: 'cust_route',
        service_address: '2 Route Way',
        service_type: 'standard',
        recurring_frequency: 'one-time',
        default_price: 100,
        status: 'active'
      }],
      visits: [{
        visit_id: 'visit_route',
        company_id: 'co_test',
        property_id: 'prop_route',
        visit_date: '2033-01-01',
        service_description: 'Regression Visit',
        price: 100,
        status: 'scheduled'
      }]
    }
  });
  const { completeVisit } = await import('../src/services/visitLifecycleService.js');
  const { createRoute, assignWorkerToRoute, getRoute } = await import('../src/data/repositories/routeRepository.js');
  const { assignVisitToRoute, getVisit } = await import('../src/data/repositories/visitRepository.js');

  const completed = await completeVisit('visit_route', {
    completed_at: '2033-01-01T12:00:00.000Z',
    completed_date: '2033-01-01'
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.completed_date, '2033-01-01');

  const route = await createRoute({
    route_id: 'route_regression',
    name: 'Regression Route',
    route_day: 'Monday',
    route_date: '2033-01-01',
    assigned_worker: 'Worker',
    employee_id: 'emp_worker',
    visit_ids: ['visit_route']
  });
  assert.equal(route.visit_ids[0], 'visit_route');

  await assignWorkerToRoute('route_regression', 'Owner', { employee_id: 'emp_owner' });
  assert.equal(getRoute('route_regression').employee_id, 'emp_owner');

  await assignVisitToRoute('visit_route', getRoute('route_regression'));
  assert.equal(getVisit('visit_route').route_id, 'route_regression');
});

test('production billing invoice generation uses Supabase RPC and syncs returned invoice', async () => {
  const requests = configureProduction({
    handlers: {
      fetch(request) {
        if (request.url.includes('/rest/v1/rpc/generate_billing_invoices')) {
          assert.deepEqual(request.body.target_visit_ids, ['visit_rpc']);
          assert.equal(request.body.target_idempotency_key, 'billing-request-1');
          return jsonResponse({
            created_count: 1,
            billed_visit_count: 1,
            invoice_ids: ['inv_rpc']
          });
        }
        if (request.url.includes('/rest/v1/invoices')) {
          return jsonResponse([{
            invoice_id: 'inv_rpc',
            company_id: 'co_test',
            customer_id: 'cust_rpc',
            invoice_number: 'REG-1',
            subtotal: 100,
            tax: 0,
            total: 100,
            payment_status: 'open',
            visit_ids: ['visit_rpc']
          }]);
        }
        return null;
      }
    }
  });
  const { createBillingInvoicesForVisits } = await import('../src/data/repositories/invoiceRepository.js');

  const summary = await createBillingInvoicesForVisits({
    visitIds: ['visit_rpc'],
    idempotencyKey: 'billing-request-1',
    invoiceDate: '2033-02-01'
  });

  assert.equal(summary.createdCount, 1);
  assert.equal(summary.billedVisitCount, 1);
  assert.equal(summary.invoiceIds[0], 'inv_rpc');
  assert.ok(requests.some((request) => request.url.includes('/rpc/generate_billing_invoices')));
});

test('production payment recording uses unique request id and strict RPC path', async () => {
  const requests = configureProduction({
    handlers: {
      fetch(request) {
        if (request.url.includes('/rest/v1/rpc/record_invoice_payment')) {
          assert.equal(request.body.target_invoice_id, 'inv_pay');
          assert.equal(request.body.target_idempotency_key, 'payment-op-1');
          assert.equal(request.body.target_amount, 40);
          return jsonResponse({
            idempotent_replay: false,
            payment: {
              payment_id: 'pay_rpc',
              company_id: 'co_test',
              invoice_id: 'inv_pay',
              idempotency_key: 'payment-op-1',
              amount: 40,
              payment_date: '2033-02-02',
              method: 'cash'
            },
            invoice: {
              invoice_id: 'inv_pay',
              company_id: 'co_test',
              total: 100,
              amount_paid: 40,
              payment_status: 'partially_paid'
            }
          });
        }
        if (request.url.includes('/rest/v1/payments')) {
          return jsonResponse([{
            payment_id: 'pay_rpc',
            company_id: 'co_test',
            invoice_id: 'inv_pay',
            idempotency_key: 'payment-op-1',
            amount: 40,
            payment_date: '2033-02-02',
            method: 'cash'
          }]);
        }
        if (request.url.includes('/rest/v1/invoices')) {
          return jsonResponse([{
            invoice_id: 'inv_pay',
            company_id: 'co_test',
            total: 100,
            amount_paid: 40,
            payment_status: 'partially_paid'
          }]);
        }
        return null;
      }
    }
  });
  const { createPayment } = await import('../src/data/repositories/paymentRepository.js');

  const payment = await createPayment({
    invoice_id: 'inv_pay',
    amount: 40,
    payment_date: '2033-02-02',
    method: 'cash',
    idempotency_key: 'payment-op-1'
  });

  assert.equal(payment.payment_id, 'pay_rpc');
  assert.ok(requests.some((request) => request.url.includes('/rpc/record_invoice_payment')));
});

test('invoice export workflow refreshes data before rendering and records export after opening print window', async () => {
  const source = await readFile(new URL('../src/invoice-workspace.js', import.meta.url), 'utf8');
  const exportHandler = source.slice(
    source.indexOf("section.querySelectorAll('[data-invoice-export]'"),
    source.indexOf("section.querySelectorAll('[data-invoice-mark-sent]'")
  );

  assert.match(exportHandler, /await getFreshInvoiceWorkspaceData\(\)/);
  assert.match(source, /await syncInvoicesFromSupabase\(\)/);
  assert.match(source, /await syncPaymentsFromSupabase\(\)/);
  assert.ok(exportHandler.indexOf('window.open') < exportHandler.indexOf('recordInvoiceExport'));
  assert.match(exportHandler, /invoice-export-window-blocked/);
});

test('XSS rendering helpers escape user-controlled content', async () => {
  const { escapeHtml, escapeAttr } = await import('../src/utils/renderSecurity.js');
  const payload = `"><img src=x onerror=alert(1)><script>alert('x')</script>`;

  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped.includes('<img'), false);
  assert.match(escaped, /&lt;script&gt;/);
  assert.equal(escapeAttr(payload), escaped);
});

test('logging formats user-safe errors and redacts production diagnostics', async () => {
  reset({ mode: 'production' });
  const {
    formatUserError,
    getOperationalLogs,
    logOperationalError
  } = await import('../src/services/operationalLogger.js');

  assert.equal(
    formatUserError(new Error('RLS policy denied access')),
    'You do not have permission to complete that action.'
  );
  assert.equal(
    formatUserError(new Error('payment insert failed')),
    'The payment could not be recorded. No partial payment changes were saved.'
  );

  logOperationalError(
    'payments',
    'payment-test',
    new Error('Supabase raw error containing invoice inv_123'),
    {
      customerName: 'Sensitive Customer',
      email: 'billing@example.test',
      invoiceId: 'inv_123',
      amount: 500
    },
    'The payment could not be recorded.'
  );

  const [entry] = getOperationalLogs();
  assert.equal(entry.details.customerName, '[redacted]');
  assert.equal(entry.details.email, '[redacted]');
  assert.equal(entry.details.invoiceId, '[redacted]');
  assert.equal(entry.details.amount, '[redacted]');
  assert.equal(entry.error.message, 'Technical details redacted in production diagnostics.');
});
