import { expect, test } from '@playwright/test';

const MODE_KEY = 'fieldcore_app_mode_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';
const STATE_KEY = 'servicebatch_invoice_mvp_v1';

async function openAsRole(page, role) {
  await page.addInitScript(({ modeKey, sessionKey, stateKey, roleValue }) => {
    const today = new Date().toISOString().slice(0, 10);
    window.FIELDCORE_APP_MODE = 'demo';
    localStorage.setItem(modeKey, 'demo');
    localStorage.setItem(stateKey, JSON.stringify({
      company: { company_id: 'co_permissions', name: 'Permissions Co', status: 'active' },
      settings: { invoice_prefix: 'PERM', default_due_days: 15, tax_rate: 0, admin_pin: '0000' },
      company_memberships: [],
      employees: [
        { employee_id: 'emp_owner', company_id: 'co_permissions', name: 'Owner User', role: 'Owner', status: 'active' },
        { employee_id: 'emp_manager', company_id: 'co_permissions', name: 'Manager User', role: 'Manager', status: 'active' },
        { employee_id: 'emp_employee', company_id: 'co_permissions', name: 'Employee User', role: 'Worker', status: 'active' }
      ],
      customers: [{ customer_id: 'cust_perm', company_id: 'co_permissions', name: 'Permission Customer', status: 'active' }],
      properties: [{
        property_id: 'prop_perm',
        company_id: 'co_permissions',
        customer_id: 'cust_perm',
        service_address: '1 Permission Way',
        service_type: 'Service',
        recurring_frequency: 'weekly',
        default_price: 100,
        status: 'active'
      }],
      visits: [{
        visit_id: 'visit_perm',
        company_id: 'co_permissions',
        property_id: 'prop_perm',
        visit_date: today,
        service_description: 'Permission visit',
        price: 100,
        status: 'scheduled',
        assigned_worker: 'Employee User'
      }],
      routes: [],
      route_stops: [],
      shifts: [],
      invoices: [{
        invoice_id: 'inv_perm',
        company_id: 'co_permissions',
        customer_id: 'cust_perm',
        invoice_number: 'PERM-1',
        invoice_date: today,
        due_date: today,
        subtotal: 100,
        tax: 0,
        total: 100,
        payment_status: 'open',
        amount_paid: 0,
        customer_name: 'Permission Customer'
      }],
      invoice_line_items: [],
      payments: [],
      activity_events: []
    }));
    const sessions = {
      owner: { role: 'admin', name: 'Owner User', membership_role: 'owner', started_at: new Date().toISOString() },
      manager: { role: 'manager', name: 'Manager User', membership_role: 'manager', started_at: new Date().toISOString() },
      employee: { role: 'worker', employee_id: 'emp_employee', name: 'Employee User', membership_role: 'employee', started_at: new Date().toISOString() }
    };
    sessionStorage.setItem(sessionKey, JSON.stringify(sessions[roleValue]));
  }, {
    modeKey: MODE_KEY,
    sessionKey: SESSION_KEY,
    stateKey: STATE_KEY,
    roleValue: role
  });
  await page.goto('/');
}

test.describe('FieldCore role permissions', () => {
  test('owner can access financial and administrative workflows', async ({ page }) => {
    await openAsRole(page, 'owner');
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Employees' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Billing Queue' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Invoices' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Payments' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'AR Dashboard' })).toBeVisible();
  });

  test('manager keeps operational access but cannot access financial actions', async ({ page }) => {
    await openAsRole(page, 'manager');
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Customers' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Route Builder' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Billing Queue' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Payments' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('button', { name: 'AR Dashboard' })).toHaveCount(0);
  });

  test('employee sees only assigned work and no company financial/admin navigation', async ({ page }) => {
    await openAsRole(page, 'employee');
    await expect(page.getByRole('heading', { name: 'My Route' })).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Customers' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Employees' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Payments' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('button', { name: 'AR Dashboard' })).toHaveCount(0);
    await expect(page.getByText('Permission visit')).toBeVisible();
  });
});
