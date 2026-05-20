const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SESSION_KEY = 'fieldcore_current_session_v1';

function loadState() {
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

function isWorkerSession() {
  return ['employee', 'worker'].includes(String(getSession()?.role || '').toLowerCase());
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function workerName(visit) {
  return visit.worker_name || visit.assigned_worker || visit.crew_name || visit.route_name || 'Unassigned / Office Route';
}

function getCrewProgress(state) {
  const todayDate = today();
  const groups = (state.visits || [])
    .filter((visit) => visit.visit_date === todayDate)
    .reduce((acc, visit) => {
      const name = workerName(visit);
      if (!acc[name]) acc[name] = { total: 0, completed: 0 };
      acc[name].total += 1;
      if (visit.status === 'completed') acc[name].completed += 1;
      return acc;
    }, {});

  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

function renderCrewProgress() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  if (isWorkerSession()) {
    sidebar.querySelector('[data-crew-progress-dock]')?.remove();
    return;
  }

  const state = loadState();
  if (!state) return;

  const progress = getCrewProgress(state);
  const existing = sidebar.querySelector('[data-crew-progress-dock]');
  const html = `
    <section class="crew-progress-dock" data-crew-progress-dock>
      <h2>Crew Progress Today</h2>
      ${progress.length ? progress.map(([name, totals]) => `
        <article class="crew-progress-row">
          <span>${name}</span>
          <strong>${totals.completed} / ${totals.total} completed</strong>
        </article>
      `).join('') : '<p>No visits scheduled today.</p>'}
    </section>
  `;

  if (existing) {
    existing.outerHTML = html;
    return;
  }

  const notificationHeading = Array.from(sidebar.querySelectorAll('h2')).find((heading) => heading.textContent?.trim() === 'Notifications');
  if (notificationHeading) {
    notificationHeading.insertAdjacentHTML('beforebegin', html);
  } else {
    sidebar.insertAdjacentHTML('beforeend', html);
  }
}

let scheduled = false;
function scheduleCrewProgressRender() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    renderCrewProgress();
  });
}

window.addEventListener('storage', scheduleCrewProgressRender);
document.addEventListener('click', () => setTimeout(scheduleCrewProgressRender, 0), true);

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleCrewProgressRender);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleCrewProgressRender();
