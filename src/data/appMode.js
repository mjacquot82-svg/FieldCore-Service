const APP_MODE_STORAGE_KEY = 'fieldcore_app_mode_v1';
const DEMO_MODE = 'demo';
const PRODUCTION_MODE = 'production';

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
  return DEMO_MODE;
}

export function getAppMode() {
  return normalizeMode(readWindowMode() || readStoredMode());
}

export function isProductionMode() {
  return getAppMode() === PRODUCTION_MODE;
}

export function canUseLocalPersistenceFallback() {
  return !isProductionMode();
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
