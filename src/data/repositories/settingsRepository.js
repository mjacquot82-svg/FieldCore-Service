import { emit } from '../appEventBus.js';
import { canUseLocalPersistenceFallback, requireRemoteResult } from '../appMode.js';
import { hashPin } from '../pinHash.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
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
  'admin_pin_hash',
  'created_at',
  'updated_at'
].join(',');
const LEGACY_SETTINGS_SELECT_FIELDS = [
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

async function ensureSupabaseCompany(state, companyId = state.company?.company_id) {
  const company = state.company;
  if (!companyId) return false;

  const response = await supabaseUpsert(
    'companies',
    {
      company_id: companyId,
      name: company.name || 'FieldCore',
      status: company.status || 'active',
      created_at: company.created_at
    },
    { onConflict: 'company_id' }
  );

  return response.configured && !response.error;
}

function normalizeSettingsForSupabase(settings, state, activeCompanyId = state.company?.company_id) {
  const companyId = settings.company_id || activeCompanyId;
  return {
    settings_id: settings.settings_id || `settings_${companyId || 'default'}`,
    company_id: companyId,
    invoice_prefix: settings.invoice_prefix || 'FC',
    default_due_days: Number(settings.default_due_days ?? 15),
    tax_rate: Number(settings.tax_rate ?? 0),
    payroll_week_start: settings.payroll_week_start || 'sunday',
    admin_pin: settings.admin_pin || null,
    admin_pin_hash: settings.admin_pin_hash || null,
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

  let response = await supabaseSelect('company_settings', {
    select: SETTINGS_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    limit: '1'
  });
  if (response.configured && response.error) {
    response = await supabaseSelect('company_settings', {
      select: LEGACY_SETTINGS_SELECT_FIELDS,
      company_id: `eq.${companyId}`,
      limit: '1'
    });
  }

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return normalizeSettingsFromSupabase(response.data[0]);
}

async function writeSupabaseSettings(settings) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const record = normalizeSettingsForSupabase(settings, state, companyId);
  if (!record.company_id) return null;

  const companyReady = await ensureSupabaseCompany(state, record.company_id);
  if (!companyReady) return null;

  const response = await supabaseUpsert('company_settings', record, {
    onConflict: 'company_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return normalizeSettingsFromSupabase(response.data[0]);
}

async function hardenAdminPin(settings) {
  if (!settings?.admin_pin || settings.admin_pin_hash) {
    return settings?.admin_pin_hash
      ? {
          ...settings,
          admin_pin: null
        }
      : settings;
  }

  return {
    ...settings,
    admin_pin: null,
    admin_pin_hash: await hashPin(settings.admin_pin)
  };
}

export async function syncSettingsFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const settings = await readSupabaseSettings(companyId);
  if (!settings) {
    if (!canUseLocalPersistenceFallback()) return null;

    const local = localSettings();
    if (!local.company_id) return null;

    const hardenedLocalSettings = await hardenAdminPin(local);
    const bootstrappedSettings = await writeSupabaseSettings(hardenedLocalSettings);
    if (!bootstrappedSettings) return null;

    writeLocalSettings(bootstrappedSettings, {
      action: 'settings:bootstrap-supabase'
    });

    return clone(bootstrappedSettings);
  }

  const hardenedSettings = await hardenAdminPin(settings);
  const migratedSettings = settings.admin_pin !== hardenedSettings.admin_pin
    ? (requireRemoteResult(
        await writeSupabaseSettings(hardenedSettings),
        'Production settings PIN migration failed.'
      ) || hardenedSettings)
    : hardenedSettings;

  writeLocalSettings(migratedSettings, {
    action: 'settings:sync-from-supabase'
  });

  return clone(migratedSettings);
}

export function getSettings() {
  return clone(localSettings());
}

export function getAdminPin() {
  return getSettings().admin_pin || DEFAULT_ADMIN_PIN;
}

export async function ensureDefaultAdminPin() {
  const state = readState();
  if (state.settings?.admin_pin || state.settings?.admin_pin_hash) return clone(state.settings);

  const settings = {
    ...(state.settings || {}),
    admin_pin: null,
    admin_pin_hash: await hashPin(DEFAULT_ADMIN_PIN)
  };

  const persistedSettings = requireRemoteResult(
    await writeSupabaseSettings(settings),
    'Production default admin PIN setup failed.'
  ) || settings;
  writeLocalSettings(persistedSettings, {
    action: 'settings:ensure-default-admin-pin'
  });

  emit('settings:changed', {
    action: 'ensure-default-admin-pin',
    settings: clone(persistedSettings)
  });

  return clone(persistedSettings);
}

export async function updateAdminPin(pin, metadata = {}) {
  const state = readState();
  const settings = {
    ...(state.settings || {}),
    admin_pin: null,
    admin_pin_hash: await hashPin(pin)
  };

  const persistedSettings = requireRemoteResult(
    await writeSupabaseSettings(settings),
    'Production admin PIN update failed.'
  ) || settings;
  writeLocalSettings(persistedSettings, {
    ...metadata,
    action: metadata.action || 'settings:update-admin-pin'
  });

  emit('settings:changed', {
    action: 'update-admin-pin',
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

  const persistedSettings = requireRemoteResult(
    await writeSupabaseSettings(settings),
    'Production payroll settings update failed.'
  ) || settings;
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
