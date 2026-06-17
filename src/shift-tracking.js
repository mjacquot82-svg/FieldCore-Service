import {
  endShift as endShiftRecord,
  getActiveShift,
  startShift as startShiftRecord
} from './data/repositories/shiftRepository.js';

const SESSION_KEY = 'fieldcore_current_session_v1';

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function isWorkerSession(session) {
  return ['employee', 'worker'].includes(String(session?.role || '').toLowerCase());
}

async function startShift(employeeId, employeeName) {
  await startShiftRecord(employeeId, { employee_name: employeeName });
  renderShiftBanner();
}

async function endShift(employeeId) {
  await endShiftRecord(employeeId);
  renderShiftBanner();
}

function renderShiftBanner() {
  const session = getSession();
  if (!session || !isWorkerSession(session)) return;

  const container = document.querySelector('[data-session-banner]');
  if (!container) return;

  const existing = document.querySelector('[data-shift-controls]');
  if (existing) existing.remove();

  const activeShift = getActiveShift(session.employee_id);

  const controls = document.createElement('span');
  controls.dataset.shiftControls = 'true';

  if (activeShift) {
    controls.innerHTML = '<button data-end-shift class="primary">End Shift</button>';

    controls
      .querySelector('[data-end-shift]')
      ?.addEventListener('click', () => endShift(session.employee_id));
  } else {
    controls.innerHTML = '<button data-start-shift class="primary">Start Shift</button>';

    controls
      .querySelector('[data-start-shift]')
      ?.addEventListener('click', () => startShift(session.employee_id, session.name));
  }

  container.appendChild(controls);
}

const observer = new MutationObserver(renderShiftBanner);
observer.observe(document.querySelector('#app'), {
  childList: true,
  subtree: true
});

renderShiftBanner();
