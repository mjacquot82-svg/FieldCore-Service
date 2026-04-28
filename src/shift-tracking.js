const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function ensureShiftArray(state) {
  if (!state.shifts) state.shifts = [];
}

function startShift(employeeId, employeeName) {
  const state = loadState();
  if (!state) return;

  ensureShiftArray(state);

  const activeShift = state.shifts.find(
    (s) => s.employee_id === employeeId && !s.ended_at
  );

  if (activeShift) return;

  state.shifts.push({
    shift_id: crypto.randomUUID(),
    employee_id: employeeId,
    employee_name: employeeName,
    started_at: new Date().toISOString()
  });

  saveState(state);
  renderShiftBanner();
}

function endShift(employeeId) {
  const state = loadState();
  if (!state) return;

  const shift = state.shifts.find(
    (s) => s.employee_id === employeeId && !s.ended_at
  );

  if (!shift) return;

  shift.ended_at = new Date().toISOString();

  saveState(state);
  renderShiftBanner();
}

function getActiveShift(employeeId) {
  const state = loadState();
  if (!state) return null;

  return state.shifts?.find(
    (s) => s.employee_id === employeeId && !s.ended_at
  );
}

function renderShiftBanner() {
  const session = getSession();
  if (!session || session.role !== 'employee') return;

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
