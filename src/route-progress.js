import { getRouteProgressForDate } from './data/repositories/visitReadRepository.js';

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

  const routeDate = getSelectedDate(section);
  const progress = getRouteProgressForDate(routeDate);

  const panel = section.querySelector('.panel');
  if (!panel) return;

  panel.insertAdjacentHTML('afterend', renderProgressBar(progress));
}

const observer = new MutationObserver(injectProgress);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

injectProgress();
