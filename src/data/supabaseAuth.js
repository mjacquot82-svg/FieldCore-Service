import {
  getSupabaseConfig,
  setSupabaseAccessTokenProvider
} from './supabaseClient.js';
import { logOperationalError, logOperationalEvent } from '../services/operationalLogger.js';

const AUTH_SESSION_KEY = 'fieldcore_supabase_auth_session_v1';
const EXPIRY_SKEW_SECONDS = 60;

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function readStoredAuthSession() {
  if (!storageAvailable()) return null;

  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
  } catch (error) {
    logOperationalError('authentication', 'auth-session-read', error, {}, 'Your saved session could not be read.');
    return null;
  }
}

function writeStoredAuthSession(session) {
  if (!storageAvailable()) return session;
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearStoredAuthSession() {
  if (!storageAvailable()) return;
  localStorage.removeItem(AUTH_SESSION_KEY);
}

function normalizeAuthSession(data) {
  if (!data?.access_token) return null;
  const expiresIn = Number(data.expires_in || 0);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null,
    token_type: data.token_type || 'bearer',
    user: data.user || null
  };
}

function isExpired(session) {
  if (!session?.expires_at) return false;
  return session.expires_at <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

async function authRequest(path, { method = 'GET', body, accessToken } = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    logOperationalEvent({
      category: 'authentication',
      severity: 'warning',
      action: `auth:${path}`,
      message: 'Supabase Auth request skipped because Supabase is not configured.',
      userMessage: 'Supabase is not configured.'
    });
    return { data: null, error: null, configured: false };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken || config.anonKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body
        ? {
            body: JSON.stringify(body)
          }
        : {})
    });

    if (!response.ok) {
      const responseText = await response.text();
      const error = new Error(`Supabase Auth request failed with ${response.status}: ${responseText}`);
      logOperationalError(
        'authentication',
        `auth:${path}`,
        error,
        { status: response.status },
        'Sign in failed. Check your credentials and try again.'
      );
      return {
        data: null,
        error,
        configured: true
      };
    }

    logOperationalEvent({
      category: 'authentication',
      severity: 'info',
      action: `auth:${path}`,
      message: 'Supabase Auth request completed.',
      details: { status: response.status }
    });

    if (response.status === 204) return { data: null, error: null, configured: true };
    return { data: await response.json(), error: null, configured: true };
  } catch (error) {
    logOperationalError(
      'authentication',
      `auth:${path}`,
      error,
      {},
      'Authentication service could not be reached.'
    );
    return { data: null, error, configured: true };
  }
}

export async function signInWithPassword(email, password) {
  const response = await authRequest('token?grant_type=password', {
    method: 'POST',
    body: {
      email,
      password
    }
  });

  if (!response.configured || response.error) return { session: null, error: response.error, configured: response.configured };

  const session = normalizeAuthSession(response.data);
  if (!session) return { session: null, error: new Error('Supabase Auth did not return a session.'), configured: true };

  writeStoredAuthSession(session);
  logOperationalEvent({
    category: 'authentication',
    severity: 'info',
    action: 'sign-in-success',
    message: 'Supabase user signed in.',
    details: { userId: session.user?.id || null, email: session.user?.email || null }
  });
  return { session, error: null, configured: true };
}

export async function refreshAuthSession(session = readStoredAuthSession()) {
  if (!session?.refresh_token) return { session: null, error: null, configured: Boolean(getSupabaseConfig()) };

  const response = await authRequest('token?grant_type=refresh_token', {
    method: 'POST',
    body: {
      refresh_token: session.refresh_token
    }
  });

  if (!response.configured || response.error) return { session: null, error: response.error, configured: response.configured };

  const nextSession = normalizeAuthSession(response.data);
  if (!nextSession) return { session: null, error: new Error('Supabase Auth did not return a refreshed session.'), configured: true };

  writeStoredAuthSession(nextSession);
  logOperationalEvent({
    category: 'authentication',
    severity: 'info',
    action: 'session-refresh-success',
    message: 'Supabase session refreshed.',
    details: { userId: nextSession.user?.id || null }
  });
  return { session: nextSession, error: null, configured: true };
}

export async function getCurrentAuthSession() {
  const session = readStoredAuthSession();
  if (!session) return null;
  if (!isExpired(session)) return session;

  const refreshed = await refreshAuthSession(session);
  if (!refreshed.session) clearStoredAuthSession();
  return refreshed.session;
}

export async function getAuthenticatedUser() {
  const session = await getCurrentAuthSession();
  if (!session?.access_token) return null;

  const response = await authRequest('user', {
    accessToken: session.access_token
  });

  if (!response.configured || response.error) {
    logOperationalEvent({
      category: 'authentication',
      severity: 'warning',
      action: 'authenticated-user-read-failed',
      message: 'Authenticated user could not be loaded.',
      userMessage: 'Your session could not be verified.'
    });
    return null;
  }
  return response.data || null;
}

export async function signOut() {
  const session = readStoredAuthSession();
  if (session?.access_token) {
    await authRequest('logout', {
      method: 'POST',
      accessToken: session.access_token
    });
  }

  clearStoredAuthSession();
  logOperationalEvent({
    category: 'authentication',
    severity: 'info',
    action: 'sign-out',
    message: 'Supabase user signed out.'
  });
  return true;
}

setSupabaseAccessTokenProvider(async () => {
  const session = await getCurrentAuthSession();
  return session?.access_token || null;
});
