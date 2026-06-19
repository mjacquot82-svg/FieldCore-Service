import { emit } from '../data/appEventBus.js';
import { getAppMode, isProductionMode } from '../data/appMode.js';

const LOG_STORAGE_KEY = 'fieldcore_operational_logs_v1';
const MAX_LOG_ENTRIES = 300;
const SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const CATEGORIES = new Set([
  'authentication',
  'authorization',
  'membership',
  'repository',
  'billing',
  'payments',
  'settings',
  'startup',
  'synchronization'
]);

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function readLogs() {
  if (!storageAvailable()) return [];
  try {
    const logs = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function writeLogs(logs) {
  if (!storageAvailable()) return;
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES)));
}

function safeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: isProductionMode() ? undefined : value.stack
    };
  }

  if (Array.isArray(value)) return value.map(safeValue);

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('token') || lowerKey.includes('key') || lowerKey.includes('pin')) {
        return [key, '[redacted]'];
      }
      return [key, safeValue(item)];
    }));
  }

  return value;
}

function normalizeSeverity(severity) {
  return SEVERITIES.has(severity) ? severity : 'info';
}

function normalizeCategory(category) {
  return CATEGORIES.has(category) ? category : 'repository';
}

export function getOperationalLogs() {
  return readLogs();
}

export function clearOperationalLogs() {
  writeLogs([]);
  emit('operational-log:cleared', {});
}

export function logOperationalEvent({
  category = 'repository',
  severity = 'info',
  action = 'event',
  message = '',
  userMessage = '',
  details = {},
  error = null
} = {}) {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const entry = {
    log_id: `log_${randomId}`,
    timestamp: new Date().toISOString(),
    mode: getAppMode(),
    category: normalizeCategory(category),
    severity: normalizeSeverity(severity),
    action: String(action || 'event'),
    message: String(message || userMessage || 'Operational event'),
    userMessage: String(userMessage || ''),
    details: safeValue(details),
    error: error ? safeValue(error) : null
  };

  const logs = readLogs();
  logs.push(entry);
  writeLogs(logs);
  emit('operational-log:created', entry);

  if (entry.severity === 'error' || entry.severity === 'critical') {
    console.error('[FieldCore]', entry);
  } else if (entry.severity === 'warning') {
    console.warn('[FieldCore]', entry);
  } else if (!isProductionMode()) {
    console.info('[FieldCore]', entry);
  }

  return entry;
}

export function logOperationalError(category, action, error, details = {}, userMessage = '') {
  return logOperationalEvent({
    category,
    severity: 'error',
    action,
    message: error?.message || 'Operation failed.',
    userMessage,
    details,
    error
  });
}

export function formatUserError(error, fallback = 'We could not complete that action. Please try again or contact support.') {
  const message = String(error?.message || '');
  if (/permission|policy|rls|not authorized|denied/i.test(message)) {
    return 'You do not have permission to complete that action.';
  }
  if (/auth|login|session|token/i.test(message)) {
    return 'Your session could not be verified. Please sign in again.';
  }
  if (/network|fetch|failed to fetch/i.test(message)) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  if (/billing|invoice/i.test(message)) {
    return 'Billing could not be completed. No partial billing changes were saved.';
  }
  if (/payment/i.test(message)) {
    return 'The payment could not be recorded. No partial payment changes were saved.';
  }
  return fallback;
}
