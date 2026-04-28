const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findRouteSection() {
  const heading = [...document.querySelectorAll('section h2')]
    .find((h) => h.textContent.includes('Today’s Route'));
  return heading?.closest('section') || null;
}

function getSelectedDate(section) {
  return section.querySelector('#route-date')?.value || today();
}

function calculateProgress(state, routeDate) {
  const visits = (state.visits || []).filter(v => v.visit_date === routeDate);

  const completed = visits.filter(v => v.status === 'completed').length;
  const skipped = visits.filter(v => v.status === 'skipped').length;
  const remaining = visits.filter(v => v.status === 'scheduled').length;

  return {
    total: visits.length,
    completed,
    skipped,
    remaining
  };
}

function renderProgressBar(progress) {
  if (!progress.total) return '';

  const percent = Math.round((progress.completed / progress.total) * 100);

  return `
    <div class="panel route-progress-panel" data-route-progress>
      <strong>Route Progress</strong>
      <p>${progress.completed} / ${progress.total} completed · ${progress.skipped} skipped · ${progress.remaining} remaining</p>
      <div class="route-progress-bar">
        <div class="route-progress-fill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function injectProgress() {
  const section = findRouteSection();
  if (!section) return;

  const existing = section.querySelector('[data-route-progress]');
  if (existing) existing.remove();

  const state = loadState();
  if (!state) return;

  const routeDate = getSelectedDate(section);
  const progress = calculateProgress(state, routeDate);

  const panel = section.querySelector('.panel');
  if (!panel) return;

  panel.insertAdjacentHTML('afterend', renderProgressBar(progress));
}

const observer = new MutationObserver(injectProgress);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

injectProgress();
