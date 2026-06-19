import { expect, test } from '@playwright/test';

const STATE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';
const MODE_KEY = 'fieldcore_app_mode_v1';

const today = () => new Date().toISOString().slice(0, 10);
const NAV_TARGETS = {
  Dashboard: 'dashboard',
  'Today’s Route': 'today-route',
  'Route Builder': 'route-builder',
  Employees: 'employees',
  Customers: 'customers',
  'Billing Queue': 'batch',
  Invoices: 'invoices',
  Payments: 'payments',
  'AR Dashboard': 'ar-dashboard',
  Settings: 'settings'
};

async function prepareDemoMode(page, session = null) {
  await page.addInitScript(({ modeKey, sessionKey, sessionValue }) => {
    window.FIELDCORE_APP_MODE = 'demo';
    localStorage.setItem(modeKey, 'demo');
    if (sessionValue) {
      sessionStorage.setItem(sessionKey, JSON.stringify(sessionValue));
    } else {
      sessionStorage.removeItem(sessionKey);
    }
  }, {
    modeKey: MODE_KEY,
    sessionKey: SESSION_KEY,
    sessionValue: session
  });
}

async function loginAsOwner(page) {
  await page.addInitScript(({ sessionKey }) => {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      role: 'admin',
      name: 'Pilot Owner',
      membership_role: 'owner',
      started_at: new Date().toISOString()
    }));
  }, { sessionKey: SESSION_KEY });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible();
}

async function nav(page, name) {
  const target = NAV_TARGETS[name];
  if (target) {
    await page.locator(`.sidebar [data-nav="${target}"]`).click();
    if (name === 'Billing Queue') {
      await expect(page.locator('section.ready-bill-queue[data-ready-bill-queue]')).toBeVisible();
    }
    return;
  }
  await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
}

async function getAppState(page) {
  return page.evaluate((stateKey) => JSON.parse(localStorage.getItem(stateKey)), STATE_KEY);
}

async function createPilotEmployee(page) {
  await nav(page, 'Employees');
  await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();
  await page.locator('#employee-form input[name="name"]').fill('Pilot Tech');
  await page.locator('#employee-form select[name="role"]').selectOption('Worker');
  await page.locator('#employee-form input[name="pin"]').fill('2468');
  await page.locator('#employee-form').getByRole('button', { name: 'Add Employee' }).click();
  await expect(page.getByRole('heading', { name: 'Pilot Tech' })).toBeVisible();
}

async function createPilotCustomer(page) {
  await nav(page, 'Customers');
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await page.locator('#customer-form input[name="name"]').fill('Pilot Customer LLC');
  await page.locator('#customer-form input[name="phone"]').fill('555-888-0101');
  await page.locator('#customer-form input[name="email"]').fill('billing@pilotcustomer.test');
  await page.locator('#customer-form input[name="billing_address"]').fill('10 Pilot Billing Rd');
  await page.locator('#customer-form').getByRole('button', { name: 'Add Customer' }).click();
  await expect(page.getByRole('heading', { name: 'Pilot Customer LLC' })).toBeVisible();
}

async function createPilotPropertyAndVisit(page) {
  await page.locator('article.panel', { hasText: 'Pilot Customer LLC' })
    .getByRole('button', { name: 'Manage Services' })
    .click();
  await expect(page.getByRole('heading', { name: /Pilot Customer LLC Services/ })).toBeVisible();

  await page.locator('#service-form input[name="service_address"]').fill('10 Pilot Service Lane');
  await page.locator('#service-form input[name="service_type"]').fill('Pilot Lawn Care');
  await page.locator('#service-form select[name="recurring_frequency"]').selectOption('weekly');
  await page.locator('#service-form input[name="default_price"]').fill('125');
  await page.locator('#service-form input[name="notes"]').fill('Pilot weekly service');
  await page.locator('#service-form').getByRole('button', { name: 'Add Service' }).click();
  const pilotServiceCard = page.locator('article.panel', { hasText: '10 Pilot Service Lane' });
  await expect(pilotServiceCard).toBeVisible();
  await expect(pilotServiceCard).toContainText('weekly');

  await page.locator('#one-off-form select[name="property_id"]').selectOption({ label: '10 Pilot Service Lane' });
  await page.locator('#one-off-form input[name="visit_date"]').fill(today());
  await page.locator('#one-off-form input[name="service_description"]').fill('Pilot recurring weekly service');
  await page.locator('#one-off-form input[name="price"]').fill('125');
  await page.locator('#one-off-form input[name="notes"]').fill('Pilot route stop');
  await page.locator('#one-off-form').getByRole('button', { name: 'Schedule One-Off Job' }).click();
  await expect(page.getByText('One-off job scheduled.')).toBeVisible();
}

async function assignPilotRoute(page) {
  await nav(page, 'Route Builder');
  await expect(page.getByRole('heading', { name: 'Route Builder' })).toBeVisible();
  await page.locator('#route-builder-date').fill(today());
  await page.locator('#route-builder-date').dispatchEvent('change');
  await expect(page.locator('.route-stop-card', { hasText: 'Pilot Customer LLC' })).toContainText('Pilot Lawn Care');

  await page.locator('#route-builder-form input[name="assigned_worker"]').fill('Pilot Tech');
  await page.locator('#route-builder-form input[name="route_name"]').fill('Pilot Route');
  const pilotStop = page.locator('.route-stop-card', { hasText: 'Pilot Customer LLC' });
  await pilotStop.locator('input[name="visit_id"]').check();
  await page.locator('#route-builder-form').getByRole('button', { name: 'Save Route' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /Pilot Route/ })).toBeVisible();
  await page.waitForTimeout(4000);
}

async function completePilotVisit(page) {
  await nav(page, 'Today’s Route');
  await page.waitForTimeout(4500);
  if (await page.locator('#route-date').count() === 0) {
    await nav(page, 'Today’s Route');
  }
  await expect(page.locator('#route-date')).toHaveValue(today());
  const routeFlow = page.locator('section.today-route-flow');
  await expect(routeFlow).toBeVisible();
  const pilotVisitCard = routeFlow.locator('article.route-flow-stop', { hasText: 'Pilot Customer LLC' })
    .filter({ hasText: 'Pilot recurring weekly service' });
  await expect(pilotVisitCard).toBeVisible();
  await pilotVisitCard.getByRole('button', { name: /Mark Completed|Complete Stop/ }).click();
  await expect.poll(async () => {
    const state = await getAppState(page);
    return state.visits.find((visit) => visit.service_description === 'Pilot recurring weekly service')?.status;
  }).toBe('completed');
}

async function generatePilotInvoice(page) {
  await nav(page, 'Billing Queue');
  await expect(page.locator('section.ready-bill-queue[data-ready-bill-queue]')).toBeVisible();
  await expect(page.locator('.ready-bill-list')).toContainText('Pilot Customer LLC');
  await expect(page.locator('article.ready-bill-row').first()).toBeVisible();
  const pilotBillingRow = page.locator('article.ready-bill-row')
    .filter({ hasText: 'Pilot Customer LLC' })
    .filter({ hasText: 'Pilot recurring weekly service' });
  await expect(pilotBillingRow).toBeVisible();
  await pilotBillingRow.getByRole('checkbox', { name: 'Select visit' }).check();
  await page.getByRole('button', { name: 'Generate Invoices' }).click();
  await expect(page.getByText(/Generated .* invoices/)).toBeVisible();
}

async function exportPilotInvoice(page) {
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  const pilotInvoiceCard = page.locator('.invoice-list-card', { hasText: 'Pilot Customer LLC' }).first();
  await expect(pilotInvoiceCard).toBeVisible();
  await pilotInvoiceCard.click();

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Export / Print' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('Pilot Customer LLC');
  await popup.close();

  await expect(page.locator('.invoice-preview-panel')).toContainText(/exported|sent|not_sent/);
}

async function recordPilotPayment(page) {
  await nav(page, 'Payments');
  await expect(page.getByRole('heading', { name: 'Payments / Outstanding Tracking' })).toBeVisible();
  const pilotPaymentCard = page.locator('article.panel', { hasText: 'Pilot Customer LLC' }).first();
  await expect(pilotPaymentCard).toBeVisible();
  await pilotPaymentCard.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByText(/marked as paid/)).toBeVisible();
}

async function verifyArDashboard(page) {
  await page.locator('.sidebar').getByRole('button', { name: 'AR Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts Receivable Dashboard' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Total AR' }).first()).toBeVisible();
  await expect(page.getByText('Recent Payments')).toBeVisible();
}

test.describe('FieldCore pilot simulation', () => {
  test.setTimeout(120000);

  test('owner completes pilot workflow from setup through AR verification', async ({ page }) => {
    await prepareDemoMode(page);
    await loginAsOwner(page);

    await createPilotEmployee(page);
    await createPilotCustomer(page);
    await createPilotPropertyAndVisit(page);
    await assignPilotRoute(page);
    await completePilotVisit(page);
    await generatePilotInvoice(page);
    await exportPilotInvoice(page);
    await recordPilotPayment(page);
    await verifyArDashboard(page);

    const state = await getAppState(page);
    const pilotCustomer = state.customers.find((customer) => customer.name === 'Pilot Customer LLC');
    const pilotProperty = state.properties.find((property) => property.service_address === '10 Pilot Service Lane');
    const pilotVisit = state.visits.find((visit) => visit.service_description === 'Pilot recurring weekly service');
    const pilotInvoice = state.invoices.find((invoice) => invoice.customer_id === pilotCustomer?.customer_id);
    const pilotPayment = state.payments.find((payment) => payment.invoice_id === pilotInvoice?.invoice_id);

    expect(state.employees.some((employee) => employee.name === 'Pilot Tech')).toBe(true);
    expect(pilotCustomer).toBeTruthy();
    expect(pilotProperty?.recurring_frequency).toBe('weekly');
    expect(pilotVisit?.status).toBe('billed');
    expect(pilotVisit?.route_id).toBeTruthy();
    expect(pilotInvoice).toBeTruthy();
    expect(pilotPayment).toBeTruthy();
  });
});
