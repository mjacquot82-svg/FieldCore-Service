import { emit } from '../appEventBus.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const DEFAULT_ADMIN_PIN = '0000';
const SETTINGS_SELECT_FIELDS = [
  'settings_id',
  'company_id',
  'invoice_prefix',
  'default_due_days',
  'tax_rate',
  'payroll_week_start',
  'admin_pin',
  'created_at',
  'updated_at'
].join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function localSettings() {
  return readState().settings || {};
}

function writeLocalSettings(settings, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    settings
  };

  writeState(nextState, metadata);
  return settings;
}

async function ensureSupabaseCompany(state) {
  const company = state.company;
  if (!company?.company_id) return false;

  const response = await supabaseUpsert(
    'companies',
    {
      company_id: company.company_id,
      name: company.name || 'FieldCore',
      status: company.status || 'active',
      created_at: company.created_at
    },
    { onConflict: 'company_id' }
  );

  return response.configured && !response.error;
}

function normalizeSettingsForSupabase(settings, state) {
  const companyId = settings.company_id || state.company?.company_id;
  return {
    settings_id: settings.settings_id || `settings_${companyId || 'default'}`,
    company_id: companyId,
    invoice_prefix: settings.invoice_prefix || 'FC',
    default_due_days: Number(settings.default_due_days ?? 15),
    tax_rate: Number(settings.tax_rate ?? 0),
    payroll_week_start: settings.payroll_week_start || 'sunday',
    admin_pin: settings.admin_pin || null,
    created_at: settings.created_at
  };
}

function normalizeSettingsFromSupabase(row) {
  if (!row) return null;
  return {
    ...row,
    default_due_days: Number(row.default_due_days ?? 15),
    tax_rate: Number(row.tax_rate ?? 0)
  };
}

async function readSupabaseSettings(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('company_settings', {
    select: SETTINGS_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return normalizeSettingsFromSupabase(response.data[0]);
}

async function writeSupabaseSettings(settings) {
  const state = readState();
  const record = normalizeSettingsForSupabase(settings, state);
  if (!record.company_id) return null;

  const companyReady = await ensureSupabaseCompany(state);
  if (!companyReady) return null;

  const response = await supabaseUpsert('company_settings', record, {
    onConflict: 'company_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return normalizeSettingsFromSupabase(response.data[0]);
}

export async function syncSettingsFromSupabase() {
  const state = readState();
  const settings = await readSupabaseSettings(state.company?.company_id);
  if (!settings) {
    const local = localSettings();
    if (!local.company_id) return null;

    const bootstrappedSettings = await writeSupabaseSettings(local);
    if (!bootstrappedSettings) return null;

    writeLocalSettings(bootstrappedSettings, {
      action: 'settings:bootstrap-supabase'
    });

    return clone(bootstrappedSettings);
  }

  writeLocalSettings(settings, {
    action: 'settings:sync-from-supabase'
  });

  return clone(settings);
}

export function getSettings() {
  return clone(localSettings());
}

export function getAdminPin() {
  return getSettings().admin_pin || DEFAULT_ADMIN_PIN;
}

export async function ensureDefaultAdminPin() {
  const state = readState();
  if (state.settings?.admin_pin) return clone(state.settings);

  const settings = {
    ...(state.settings || {}),
    admin_pin: DEFAULT_ADMIN_PIN
  };

  const persistedSettings = (await writeSupabaseSettings(settings)) || settings;
  writeLocalSettings(persistedSettings, {
    action: 'settings:ensure-default-admin-pin'
  });

  emit('settings:changed', {
    action: 'ensure-default-admin-pin',
    settings: clone(persistedSettings)
  });

  return clone(persistedSettings);
}

export async function updatePayrollWeekStart(payrollWeekStart) {
  const state = readState();
  const settings = {
    ...(state.settings || {}),
    payroll_week_start: payrollWeekStart
  };

  const persistedSettings = (await writeSupabaseSettings(settings)) || settings;
  writeLocalSettings(persistedSettings, {
    action: 'settings:update-payroll-week-start',
    payroll_week_start: payrollWeekStart
  });

  emit('settings:changed', {
    action: 'update-payroll-week-start',
    payroll_week_start: payrollWeekStart,
    settings: clone(persistedSettings)
  });

  return clone(persistedSettings);
}
