const CONFIG_STORAGE_KEY = 'fieldcore_supabase_config_v1';
let accessTokenProvider = null;

function readStoredConfig() {
  if (typeof localStorage === 'undefined') return null;

  try {
    return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null');
  } catch {
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
  } catch {
    return config.anonKey;
  }
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
  if (!config) return { data: null, error: null, configured: false };
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
      return {
        data: null,
        error: new Error(`Supabase request failed with ${response.status}: ${await response.text()}`),
        configured: true
      };
    }

    if (response.status === 204) return { data: null, error: null, configured: true };

    return {
      data: await response.json(),
      error: null,
      configured: true
    };
  } catch (error) {
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
