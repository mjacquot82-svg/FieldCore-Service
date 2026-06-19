const APP_MODE_STORAGE_KEY = 'fieldcore_app_mode_v1';
const DEMO_MODE = 'demo';
const PRODUCTION_MODE = 'production';
const INVALID_MODE = 'invalid';

function readStoredMode() {
  if (typeof localStorage === 'undefined') return null;

  try {
    return localStorage.getItem(APP_MODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readWindowMode() {
  if (typeof window === 'undefined') return null;
  return window.FIELDCORE_APP_MODE || window.FIELDCORE_SUPABASE_CONFIG?.mode || null;
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === PRODUCTION_MODE || mode === 'prod') return PRODUCTION_MODE;
  if (mode === DEMO_MODE) return DEMO_MODE;
  return INVALID_MODE;
}

export function getRawAppMode() {
  return readWindowMode() || readStoredMode() || '';
}

export function isValidAppMode() {
  return getAppMode() !== INVALID_MODE;
}

export function isDemoMode() {
  return getAppMode() === DEMO_MODE;
}

export function getAppModeRequirementMessage() {
  if (isValidAppMode()) return '';
  const rawMode = String(getRawAppMode() || '').trim();
  if (!rawMode) return 'FieldCore requires an explicit app mode. Set mode to "demo" for demo storage or "production" for Supabase-backed production.';
  return `FieldCore app mode "${rawMode}" is not valid. Set mode to "demo" or "production".`;
}

export function getAppMode() {
  return normalizeMode(getRawAppMode());
}

export function isProductionMode() {
  return getAppMode() === PRODUCTION_MODE;
}

export function canUseLocalPersistenceFallback() {
  return isDemoMode();
}

export function requireRemoteResult(result, message = 'Remote persistence failed.') {
  if (result || canUseLocalPersistenceFallback()) return result;
  throw new Error(message);
}

export function getProductionModeRequirementMessage(diagnostics = {}) {
  if (!isProductionMode()) return '';
  if (!diagnostics.supabaseConfigured) return 'Production mode requires Supabase configuration.';
  if (!diagnostics.authenticated) return 'Production mode requires an authenticated Supabase user.';
  if (!diagnostics.transportAuthenticated) return 'Production mode requires authenticated Supabase transport.';
  if (!diagnostics.companyResolved) return 'Production mode requires a resolved company context.';
  if (!diagnostics.membershipActive) return 'Production mode requires an active company membership.';
  if (!diagnostics.membershipUserLinked) return 'Production mode requires the company membership to be linked to the authenticated user.';
  return '';
}
