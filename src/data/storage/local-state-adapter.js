import { emit } from '../appEventBus.js';
import { seedData } from '../seed.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const STATE_CHANGED_EVENT = 'state:changed';

const clone = (value) => JSON.parse(JSON.stringify(value));
const subscribers = new Set();

function parseStoredState(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function notify(change) {
  subscribers.forEach((listener) => {
    listener(change);
  });
  emit(STATE_CHANGED_EVENT, change);
}

export function readState() {
  if (!storageAvailable()) return clone(seedData);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = clone(seedData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  return JSON.parse(raw);
}

export function writeState(nextState, metadata = {}) {
  if (!storageAvailable()) return nextState;

  const previousState = readState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  notify({
    key: STORAGE_KEY,
    state: nextState,
    previousState,
    metadata,
    source: 'local-state-adapter'
  });
  return nextState;
}

export function resetState() {
  const seeded = clone(seedData);
  return writeState(seeded, { action: 'reset' });
}

export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;

    notify({
      key: STORAGE_KEY,
      state: parseStoredState(event.newValue),
      previousState: parseStoredState(event.oldValue),
      metadata: { action: 'external-storage-event' },
      source: 'storage'
    });
  });
}
