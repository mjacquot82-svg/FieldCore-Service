const CONFIG_STORAGE_KEY = 'fieldcore_supabase_config_v1';

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

export async function supabaseSelect(table, params = {}) {
  const config = getSupabaseConfig();
  if (!config) return { data: null, error: null, configured: false };

  const url = new URL(`${config.url}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return {
        data: null,
        error: new Error(`Supabase request failed with ${response.status}`),
        configured: true
      };
    }

    return {
      data: await response.json(),
      error: null,
      configured: true
    };
  } catch (error) {
    return { data: null, error, configured: true };
  }
}
