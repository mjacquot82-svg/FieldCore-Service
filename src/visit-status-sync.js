import { isProductionMode } from './data/appMode.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SYNC_EVENT_NAME = 'fieldcore:visit-status-sync';

function readState() {
  if (isProductionMode()) return null;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function visitSnapshot(state) {
  return JSON.stringify((state?.visits || []).map((visit) => ({
    visit_id: visit.visit_id,
    status: visit.status,
    completed_at: visit.completed_at || '',
    skipped_at: visit.skipped_at || '',
    rescheduled_to: visit.rescheduled_to || '',
    route_id: visit.route_id || '',
    assigned_worker: visit.assigned_worker || '',
    worker_name: visit.worker_name || ''
  })));
}

let lastVisitSnapshot = visitSnapshot(readState());

function isOperationalView() {
  const heading = document.querySelector('main.content h2')?.textContent?.trim() || '';
  return [
    'Today’s Route',
    'Today’s Route / Daily Work List',
    'Overdue Visits',
    'Operations Dashboard',
    'Billing Queue',
    'Ready to Bill'
  ].some((title) => heading.includes(title));
}

function refreshOperationalView() {
  if (!isOperationalView()) return;

  const activeRouteDate = document.querySelector('#route-date')?.value;
  if (activeRouteDate) sessionStorage.setItem('fieldcore_last_route_date', activeRouteDate);

  window.location.reload();
}

function detectVisitChanges(source = 'local') {
  const nextSnapshot = visitSnapshot(readState());
  if (nextSnapshot === lastVisitSnapshot) return;

  lastVisitSnapshot = nextSnapshot;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT_NAME, { detail: { source } }));
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  detectVisitChanges('storage');
});

window.addEventListener(SYNC_EVENT_NAME, refreshOperationalView);

const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function patchedSetItem(key, value) {
  originalSetItem.call(this, key, value);
  if (this === localStorage && key === STORAGE_KEY) {
    window.requestAnimationFrame(() => detectVisitChanges('same-tab'));
  }
};

// Restore route date after a sync-triggered reload so the owner stays on the same day.
window.addEventListener('DOMContentLoaded', () => {
  const savedRouteDate = sessionStorage.getItem('fieldcore_last_route_date');
  const routeDateInput = document.querySelector('#route-date');
  if (savedRouteDate && routeDateInput && routeDateInput.value !== savedRouteDate) {
    routeDateInput.value = savedRouteDate;
    routeDateInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
