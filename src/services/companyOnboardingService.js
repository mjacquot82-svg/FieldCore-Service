import { isProductionMode } from '../data/appMode.js';
import { hashPin } from '../data/pinHash.js';
import {
  resolveRepositoryCompanyContext,
  validateRepositoryAuthContext
} from '../data/repositoryContext.js';
import { writeState } from '../data/storage/local-state-adapter.js';
import { getAuthenticatedUser } from '../data/supabaseAuth.js';
import { supabaseUpsert } from '../data/supabaseClient.js';
import {
  logOperationalError,
  logOperationalEvent
} from './operationalLogger.js';

const EMPTY_COLLECTIONS = {
  employees: [],
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

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeCompanyName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePin(value) {
  return String(value || '').trim();
}

function normalizeInvoicePrefix(value) {
  const prefix = String(value || 'FC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return prefix || 'FC';
}

function normalizeDueDays(value) {
  const dueDays = Number(value ?? 15);
  if (!Number.isFinite(dueDays)) return 15;
  return Math.max(0, Math.min(365, Math.round(dueDays)));
}

function normalizeTaxRate(value) {
  const taxRate = Number(value ?? 0);
  if (!Number.isFinite(taxRate)) return 0;
  return Math.max(0, Math.min(1, taxRate));
}

function normalizePayrollWeekStart(value) {
  return value === 'monday' ? 'monday' : 'sunday';
}

function validateOnboardingInput(input) {
  const companyName = normalizeCompanyName(input.companyName);
  const adminPin = normalizePin(input.adminPin);
  const confirmAdminPin = normalizePin(input.confirmAdminPin);

  if (companyName.length < 2) throw new Error('Company name is required.');
  if (!/^[0-9]{4}$/.test(adminPin)) throw new Error('Owner/admin PIN must be exactly 4 digits.');
  if (adminPin !== confirmAdminPin) throw new Error('Owner/admin PIN confirmation does not match.');

  return {
    companyName,
    adminPin,
    invoicePrefix: normalizeInvoicePrefix(input.invoicePrefix),
    defaultDueDays: normalizeDueDays(input.defaultDueDays),
    taxRate: normalizeTaxRate(input.taxRate),
    payrollWeekStart: normalizePayrollWeekStart(input.payrollWeekStart)
  };
}

async function persistCompany(company) {
  const response = await supabaseUpsert('companies', company, {
    onConflict: 'company_id'
  });
  if (!response.configured) throw new Error('Supabase is not configured.');
  if (response.error || !Array.isArray(response.data) || !response.data[0]) {
    throw response.error || new Error('Company could not be created.');
  }
  return response.data[0];
}

async function persistOwnerMembership(membership) {
  const response = await supabaseUpsert('company_memberships', membership, {
    onConflict: 'membership_id'
  });
  if (!response.configured) throw new Error('Supabase is not configured.');
  if (response.error || !Array.isArray(response.data) || !response.data[0]) {
    throw response.error || new Error('Owner membership could not be created.');
  }
  return response.data[0];
}

async function persistCompanySettings(settings) {
  const response = await supabaseUpsert('company_settings', settings, {
    onConflict: 'company_id'
  });
  if (!response.configured) throw new Error('Supabase is not configured.');
  if (response.error || !Array.isArray(response.data) || !response.data[0]) {
    throw response.error || new Error('Company settings could not be created.');
  }
  return response.data[0];
}

function writeOnboardedState({ company, settings, membership }) {
  writeState({
    company,
    settings,
    company_memberships: [membership],
    ...EMPTY_COLLECTIONS
  }, {
    action: 'company-onboarding:complete',
    company_id: company.company_id,
    membership_id: membership.membership_id
  });
}

export async function createProductionOwnerCompany(input = {}) {
  if (!isProductionMode()) throw new Error('Company onboarding is only available in production mode.');

  const user = await getAuthenticatedUser();
  if (!user?.id) throw new Error('Your session could not be verified. Please sign in again.');

  const existingDiagnostics = await validateRepositoryAuthContext();
  if (existingDiagnostics.membershipActive) {
    throw new Error('This account already has an active company membership.');
  }

  const values = validateOnboardingInput(input);
  const now = new Date().toISOString();
  const companyId = makeId('co');
  const company = {
    company_id: companyId,
    name: values.companyName,
    status: 'active',
    created_at: now
  };
  const membership = {
    membership_id: makeId('mbr'),
    company_id: companyId,
    user_id: user.id,
    employee_id: null,
    role: 'owner',
    status: 'active',
    created_at: now
  };
  const settings = {
    settings_id: makeId('settings'),
    company_id: companyId,
    invoice_prefix: values.invoicePrefix,
    default_due_days: values.defaultDueDays,
    tax_rate: values.taxRate,
    payroll_week_start: values.payrollWeekStart,
    admin_pin: null,
    admin_pin_hash: await hashPin(values.adminPin),
    created_at: now
  };

  try {
    logOperationalEvent({
      category: 'onboarding',
      severity: 'info',
      action: 'company-onboarding-start',
      message: 'Production company onboarding started.',
      details: { userId: user.id }
    });

    const persistedCompany = await persistCompany(company);
    const persistedMembership = await persistOwnerMembership(membership);
    const persistedSettings = await persistCompanySettings(settings);

    writeOnboardedState({
      company: persistedCompany,
      settings: persistedSettings,
      membership: persistedMembership
    });
    await resolveRepositoryCompanyContext();

    logOperationalEvent({
      category: 'onboarding',
      severity: 'info',
      action: 'company-onboarding-complete',
      message: 'Production company onboarding completed.',
      details: {
        userId: user.id,
        companyId: persistedCompany.company_id,
        membershipId: persistedMembership.membership_id
      }
    });

    return {
      company: persistedCompany,
      settings: persistedSettings,
      membership: persistedMembership
    };
  } catch (error) {
    logOperationalError(
      'onboarding',
      'company-onboarding-failed',
      error,
      { userId: user.id, companyId },
      'Company setup could not be completed. Please try again or contact support.'
    );
    throw error;
  }
}
