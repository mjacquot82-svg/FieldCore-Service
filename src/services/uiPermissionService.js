import { isProductionMode } from '../data/appMode.js';

const FINANCIAL_VIEWS = new Set(['batch', 'invoices', 'payments', 'ar-dashboard']);
const ADMINISTRATIVE_VIEWS = new Set(['employees', 'settings']);
const OPERATIONAL_VIEWS = new Set(['dashboard', 'today-route', 'route-builder', 'customers', 'timeline', 'properties', 'visits']);
const EMPLOYEE_VIEWS = new Set(['worker-route']);

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'owner/admin') return 'admin';
  if (normalized === 'worker') return 'employee';
  return normalized;
}

export function getEffectiveRole(session) {
  if (!session) return '';
  const membershipRole = normalizeRole(session.membership_role);
  if (isProductionMode() && membershipRole) return membershipRole;
  return normalizeRole(session.role);
}

export function getUiPermissions(session) {
  const role = getEffectiveRole(session);
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isEmployee = role === 'employee';
  const elevated = isOwner || isAdmin;
  const operational = elevated || isManager;

  return {
    role,
    isEmployee,
    navigation: {
      dashboard: operational,
      'today-route': operational,
      'route-builder': operational,
      employees: operational,
      customers: operational,
      batch: operational,
      invoices: operational,
      payments: operational,
      'ar-dashboard': operational,
      settings: operational,
      'worker-route': isEmployee
    },
    customers: {
      read: operational,
      create: operational,
      update: operational,
      deactivate: elevated,
      ledger: operational
    },
    properties: {
      read: operational,
      create: operational,
      update: operational,
      deactivate: elevated
    },
    employees: {
      read: operational,
      create: elevated,
      update: elevated,
      delete: elevated
    },
    visits: {
      readCompanyWide: operational,
      create: operational,
      updateCompanyWide: operational,
      updateAssignedLifecycle: isEmployee
    },
    routes: {
      readCompanyWide: operational,
      create: operational,
      update: operational,
      assign: operational
    },
    financials: {
      read: operational,
      createInvoices: operational,
      recordPayments: operational,
      exportInvoices: operational
    },
    settings: {
      read: operational,
      write: elevated,
      resetDemoData: !isProductionMode() && elevated
    }
  };
}

export function canAccessView(view, session) {
  const permissions = getUiPermissions(session);
  return Boolean(permissions.navigation[view]);
}

export function getDefaultView(session) {
  const permissions = getUiPermissions(session);
  if (permissions.isEmployee) return 'worker-route';
  if (permissions.navigation.dashboard) return 'dashboard';
  return 'worker-route';
}

export function getRestrictedViewReason(view, session) {
  const role = getEffectiveRole(session) || 'unauthenticated';
  if (FINANCIAL_VIEWS.has(view)) return `Role "${role}" cannot access financial screens.`;
  if (ADMINISTRATIVE_VIEWS.has(view)) return `Role "${role}" cannot access administrative screens.`;
  if (OPERATIONAL_VIEWS.has(view)) return `Role "${role}" cannot access company-wide operational screens.`;
  if (EMPLOYEE_VIEWS.has(view)) return `Role "${role}" cannot access the employee route screen.`;
  return `Role "${role}" cannot access this screen.`;
}

export function allowedNavItems(navItems, session) {
  return navItems.filter(([id]) => canAccessView(id, session));
}
