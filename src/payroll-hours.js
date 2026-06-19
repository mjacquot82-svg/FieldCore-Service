import { updatePayrollWeekStart } from './data/repositories/settingsRepository.js';
import { getUiPermissions } from './services/uiPermissionService.js';
import { isProductionMode } from './data/appMode.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';

function loadState() {
  if (isProductionMode()) return null;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function isWorkerSession(session) {
  return getUiPermissions(session).isEmployee;
}

function permissions() {
  return getUiPermissions(getSession());
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function shiftStartDate(shift) {
  return String(shift.started_at || '').slice(0, 10);
}

function shiftHours(shift) {
  if (!shift.started_at) return 0;
  const start = new Date(shift.started_at);
  const end = shift.ended_at ? new Date(shift.ended_at) : new Date();
  return Math.max(0, (end - start) / 36e5);
}

function payrollWeekStartIndex(state) {
  const saved = state?.settings?.payroll_week_start;
  return saved === 'monday' ? 1 : 0;
}

function getPayrollPeriod(referenceDate = new Date(), weekStartIndex = 0, offsetWeeks = 0) {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const diff = (start.getDay() - weekStartIndex + 7) % 7;
  start.setDate(start.getDate() - diff + offsetWeeks * 7);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start: dateOnly(start), end: dateOnly(end) };
}

function shiftsInRange(state, startDate, endDate, employeeId = '') {
  return (state.shifts || []).filter((shift) => {
    const date = shiftStartDate(shift);
    if (!date || date < startDate || date > endDate) return false;
    if (employeeId && shift.employee_id !== employeeId) return false;
    return true;
  });
}

function summarizeShifts(shifts) {
  const days = new Set(shifts.map(shiftStartDate).filter(Boolean));
  const hours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
  return {
    daysWorked: days.size,
    hours: Number(hours.toFixed(2))
  };
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function employeeMyHoursPanel() {
  const state = loadState();
  const session = getSession();
  if (!state || !session || !isWorkerSession(session)) return '';

  const weekStart = payrollWeekStartIndex(state);
  const period = getPayrollPeriod(new Date(), weekStart);
  const today = todayString();
  const todaySummary = summarizeShifts(shiftsInRange(state, today, today, session.employee_id));
  const periodSummary = summarizeShifts(shiftsInRange(state, period.start, period.end, session.employee_id));
  const activeShift = (state.shifts || []).find((shift) => shift.employee_id === session.employee_id && !shift.ended_at);

  return `
    <section class="panel my-hours-panel" data-my-hours-panel>
      <h3>My Hours</h3>
      <p>Shift status: <strong>${activeShift ? 'Active' : 'Not started'}</strong>${activeShift ? ` · Started ${formatTime(activeShift.started_at)}` : ''}</p>
      <div class="customer-overview">
        <div><span>Today</span><strong>${todaySummary.hours} hrs</strong></div>
        <div><span>This payroll period</span><strong>${periodSummary.hours} hrs</strong></div>
        <div><span>Days worked</span><strong>${periodSummary.daysWorked}</strong></div>
      </div>
      <p>Payroll period: ${period.start} → ${period.end}</p>
    </section>
  `;
}

function injectEmployeeHoursPanel() {
  const session = getSession();
  if (!session || !isWorkerSession(session)) return;

  const main = document.querySelector('main.content');
  if (!main || main.querySelector('[data-my-hours-panel]')) return;

  const banner = main.querySelector('[data-session-banner]');
  const panelHtml = employeeMyHoursPanel();
  if (!panelHtml) return;

  if (banner) {
    banner.insertAdjacentHTML('afterend', panelHtml);
  } else {
    main.insertAdjacentHTML('afterbegin', panelHtml);
  }
}

function ensurePayrollSettingsButton() {
  const access = permissions();
  if (!access.settings.read) return;
  const settingsHeading = [...document.querySelectorAll('section h2')]
    .find((heading) => heading.textContent.trim() === 'Settings');
  if (!settingsHeading) return;

  const panel = settingsHeading.closest('section')?.querySelector('.panel');
  if (!panel || panel.querySelector('[data-payroll-settings]')) return;

  const state = loadState();
  const currentStart = state?.settings?.payroll_week_start || 'sunday';
  const settingsButtons = access.settings.write
    ? '<button data-set-payroll-week="sunday">Week starts Sunday</button><button data-set-payroll-week="monday">Week starts Monday</button>'
    : '';

  panel.insertAdjacentHTML('beforeend', `
    <hr />
    <h3>Payroll</h3>
    <p>Payroll week starts on: <strong>${currentStart === 'monday' ? 'Monday' : 'Sunday'}</strong></p>
    <div class="actions" data-payroll-settings>
      ${settingsButtons}
      <button data-export-payroll="current">Export Current Period CSV</button>
      <button data-export-payroll="previous">Export Previous Period CSV</button>
    </div>
  `);

  panel.querySelectorAll('[data-set-payroll-week]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!permissions().settings.write) return;
      const nextState = loadState();
      if (!nextState) return;
      await updatePayrollWeekStart(button.dataset.setPayrollWeek);
      window.alert(`Payroll week now starts on ${button.dataset.setPayrollWeek}.`);
      window.location.reload();
    });
  });

  panel.querySelectorAll('[data-export-payroll]').forEach((button) => {
    button.addEventListener('click', () => exportPayrollCsv(button.dataset.exportPayroll));
  });
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function exportPayrollCsv(periodType = 'current') {
  const state = loadState();
  if (!state) return;

  const offset = periodType === 'previous' ? -1 : 0;
  const period = getPayrollPeriod(new Date(), payrollWeekStartIndex(state), offset);
  const shifts = shiftsInRange(state, period.start, period.end);

  const rows = [
    ['Employee', 'Date', 'Start Time', 'End Time', 'Hours Worked', 'Shift Status', 'Payroll Period Start', 'Payroll Period End']
  ];

  shifts.forEach((shift) => {
    rows.push([
      shift.employee_name || 'Unknown Employee',
      shiftStartDate(shift),
      formatTime(shift.started_at),
      formatTime(shift.ended_at),
      shiftHours(shift).toFixed(2),
      shift.ended_at ? 'Closed' : 'Active',
      period.start,
      period.end
    ]);
  });

  const employeeGroups = new Map();
  shifts.forEach((shift) => {
    const key = shift.employee_id || shift.employee_name || 'unknown';
    if (!employeeGroups.has(key)) employeeGroups.set(key, []);
    employeeGroups.get(key).push(shift);
  });

  rows.push([]);
  rows.push(['Summary', '', '', '', '', '', '', '']);
  employeeGroups.forEach((employeeShifts) => {
    const summary = summarizeShifts(employeeShifts);
    rows.push([
      employeeShifts[0]?.employee_name || 'Unknown Employee',
      `Days worked: ${summary.daysWorked}`,
      '',
      '',
      `Total hours: ${summary.hours.toFixed(2)}`,
      '',
      period.start,
      period.end
    ]);
  });

  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fieldcore-payroll-${period.start}-to-${period.end}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function enhancePayrollHours() {
  injectEmployeeHoursPanel();
  ensurePayrollSettingsButton();
}

const observer = new MutationObserver(enhancePayrollHours);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

enhancePayrollHours();
