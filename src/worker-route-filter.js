const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const WORKER_FILTER_ID = 'worker-route-filter';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function getTodayRouteSection() {
  const heading = [...document.querySelectorAll('section h2')]
    .find((item) => ['Today’s Route / Daily Work List', 'Overdue Visits'].includes(item.textContent.trim()));

  return heading?.closest('section') || null;
}

function getSelectedRouteDate(section) {
  return section.querySelector('#route-date')?.value || new Date().toISOString().slice(0, 10);
}

function getAssignedWorkersForDate(state, routeDate) {
  return [...new Set(
    (state.routes || [])
      .filter((route) => route.route_date === routeDate && route.assigned_worker)
      .map((route) => route.assigned_worker.trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function getVisitLookup(state) {
  return new Map((state.visits || []).map((visit) => [visit.visit_id, visit]));
}

function getAssignedVisitIds(state, routeDate, workerName) {
  if (!workerName) return new Set();

  const assignedRouteVisitIds = (state.routes || [])
    .filter((route) => route.route_date === routeDate && route.assigned_worker === workerName)
    .flatMap((route) => route.visit_ids || []);

  const assignedVisitIds = (state.visits || [])
    .filter((visit) => visit.visit_date === routeDate && visit.assigned_worker === workerName)
    .map((visit) => visit.visit_id);

  return new Set([...assignedRouteVisitIds, ...assignedVisitIds]);
}

function visitMatchesCard(visit, cardText) {
  return cardText.includes(`Visit date ${visit.visit_date}`)
    && cardText.includes(visit.service_description || '')
    && cardText.includes(`Status: ${visit.status}`);
}

function applyWorkerFilter(section, state, workerName) {
  const routeDate = getSelectedRouteDate(section);
  const assignedVisitIds = getAssignedVisitIds(state, routeDate, workerName);
  const visitsById = getVisitLookup(state);
  const assignedVisits = [...assignedVisitIds].map((visitId) => visitsById.get(visitId)).filter(Boolean);

  section.querySelectorAll('article.panel').forEach((card) => {
    const cardText = card.textContent || '';
    const isVisitCard = cardText.includes('Visit date ') && cardText.includes('Status:');
    if (!isVisitCard) return;

    const shouldShow = !workerName || assignedVisits.some((visit) => visitMatchesCard(visit, cardText));
    card.hidden = !shouldShow;
  });

  const existingEmpty = section.querySelector('[data-worker-route-empty]');
  if (existingEmpty) existingEmpty.remove();

  const visibleVisitCards = [...section.querySelectorAll('article.panel')]
    .filter((card) => !card.hidden && (card.textContent || '').includes('Visit date ') && (card.textContent || '').includes('Status:'));

  if (workerName && visibleVisitCards.length === 0) {
    const emptyCard = document.createElement('article');
    emptyCard.className = 'panel';
    emptyCard.setAttribute('data-worker-route-empty', 'true');
    emptyCard.innerHTML = `<p>No assigned stops found for ${workerName} on this date.</p>`;
    section.querySelector('.stack')?.appendChild(emptyCard);
  }
}

function injectWorkerFilter() {
  const section = getTodayRouteSection();
  if (!section) return;

  const state = loadState();
  if (!state) return;

  const routeDate = getSelectedRouteDate(section);
  const workers = getAssignedWorkersForDate(state, routeDate);
  const datePanel = section.querySelector('.panel');
  if (!datePanel) return;

  if (!datePanel.querySelector(`#${WORKER_FILTER_ID}`)) {
    datePanel.insertAdjacentHTML('beforeend', `
      <label class="worker-route-filter-label">Assigned worker / route
        <select id="${WORKER_FILTER_ID}">
          <option value="">All scheduled stops</option>
          ${workers.map((worker) => `<option value="${worker}">${worker}</option>`).join('')}
        </select>
      </label>
    `);

    datePanel.querySelector(`#${WORKER_FILTER_ID}`)?.addEventListener('change', (event) => {
      applyWorkerFilter(section, loadState(), event.target.value);
    });
  }

  const selectedWorker = datePanel.querySelector(`#${WORKER_FILTER_ID}`)?.value || '';
  applyWorkerFilter(section, state, selectedWorker);
}

const observer = new MutationObserver(injectWorkerFilter);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

injectWorkerFilter();
