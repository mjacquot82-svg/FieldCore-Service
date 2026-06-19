import { logOperationalError, logOperationalEvent } from '../services/operationalLogger.js';

const CONFIG_STORAGE_KEY = 'fieldcore_supabase_config_v1';
let accessTokenProvider = null;

function readStoredConfig() {
  if (typeof localStorage === 'undefined') return null;

  try {
    return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null');
  } catch (error) {
    logOperationalError('startup', 'supabase-config-read', error, {}, 'Supabase configuration could not be read.');
    return null;
  }
}

function readWindowConfig() {
  if (typeof window === 'undefined') return null;
  return window.FIELDCORE_SUPABASE_CONFIG || null;
}

function normalizeConfig(config) {
  const url = String(config?.url || config?.supabaseUrl || '').replace(/\/+$/, '');
  const anonKey = String(config?.anonKey || config?.supabaseAnonKey || '').trim();

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function getSupabaseConfig() {
  return normalizeConfig(readWindowConfig()) || normalizeConfig(readStoredConfig());
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig());
}

export function setSupabaseAccessTokenProvider(provider) {
  accessTokenProvider = typeof provider === 'function' ? provider : null;
}

async function getAuthorizationToken(config) {
  if (!accessTokenProvider) return config.anonKey;

  try {
    return (await accessTokenProvider()) || config.anonKey;
  } catch (error) {
    logOperationalError('authentication', 'supabase-token-provider', error, {}, 'Your session could not be verified.');
    return config.anonKey;
  }
}

function categoryForTable(table) {
  if (table.includes('rpc/generate_billing_invoices')) return 'billing';
  if (table.includes('rpc/record_invoice_payment')) return 'payments';
  if (table.includes('settings')) return 'settings';
  return 'repository';
}

function actionForRequest(table, method) {
  if (table.startsWith('rpc/')) return `rpc:${table.slice(4)}`;
  return `${method.toLowerCase()}:${table}`;
}

export async function getSupabaseTransportContext() {
  const config = getSupabaseConfig();
  if (!config) {
    return {
      configured: false,
      authenticated: false,
      authorization: 'unconfigured'
    };
  }

  const authorizationToken = await getAuthorizationToken(config);
  const authenticated = authorizationToken !== config.anonKey;

  return {
    configured: true,
    authenticated,
    authorization: authenticated ? 'authenticated-user' : 'anon-key'
  };
}

async function supabaseRequest(table, { method = 'GET', params = {}, body, headers = {} } = {}) {
  const config = getSupabaseConfig();
  const category = categoryForTable(table);
  const action = actionForRequest(table, method);
  if (!config) {
    logOperationalEvent({
      category: 'startup',
      severity: 'warning',
      action: 'supabase-request-unconfigured',
      message: 'Supabase request skipped because Supabase is not configured.',
      userMessage: 'Supabase is not configured.',
      details: { table, method }
    });
    return { data: null, error: null, configured: false };
  }
  const authorizationToken = await getAuthorizationToken(config);

  const url = new URL(`${config.url}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${authorizationToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      ...(body
        ? {
            body: JSON.stringify(body)
          }
        : {})
    });

    if (!response.ok) {
      const responseText = await response.text();
      const error = new Error(`Supabase request failed with ${response.status}: ${responseText}`);
      logOperationalError(
        category,
        action,
        error,
        { table, method, status: response.status, params },
        'The server rejected the request. Please contact support if this continues.'
      );
      return {
        data: null,
        error,
        configured: true
      };
    }

    logOperationalEvent({
      category,
      severity: 'info',
      action,
      message: 'Supabase request completed.',
      details: { table, method, status: response.status }
    });

    if (response.status === 204) return { data: null, error: null, configured: true };

    return {
      data: await response.json(),
      error: null,
      configured: true
    };
  } catch (error) {
    logOperationalError(
      category,
      action,
      error,
      { table, method, params },
      'The server could not be reached. Check your connection and try again.'
    );
    return { data: null, error, configured: true };
  }
}

export async function supabaseSelect(table, params = {}) {
  return supabaseRequest(table, { params });
}

export async function supabaseUpsert(table, records, { onConflict } = {}) {
  const params = {};
  if (onConflict) params.on_conflict = onConflict;

  return supabaseRequest(table, {
    method: 'POST',
    params,
    body: Array.isArray(records) ? records : [records],
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    }
  });
}

export async function supabaseDelete(table, params = {}) {
  return supabaseRequest(table, {
    method: 'DELETE',
    params,
    headers: {
      Prefer: 'return=representation'
    }
  });
}

export async function supabaseRpc(functionName, body = {}) {
  return supabaseRequest(`rpc/${functionName}`, {
    method: 'POST',
    body
  });
}
