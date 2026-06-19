import { isProductionMode } from './data/appMode.js';
import { escapeAttr, escapeHtml } from './utils/renderSecurity.js';

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

function getEmployeeNameById(state) {
  return new Map((state.employees || []).map((employee) => [employee.employee_id, employee.name]));
}

function getAssignedWorkersForDate(state, routeDate) {
  const employeeNameById = getEmployeeNameById(state);
  const routes = (state.routes || []).filter((route) => route.route_date === routeDate);
  if (isProductionMode()) {
    return routes
      .filter((route) => route.employee_id)
      .map((route) => ({
        value: route.employee_id,
        label: employeeNameById.get(route.employee_id) || route.assigned_worker || route.employee_id
      }))
      .filter((worker, index, workers) => workers.findIndex((item) => item.value === worker.value) === index)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return [...new Set(
    routes
      .filter((route) => route.assigned_worker)
      .map((route) => route.assigned_worker.trim())
      .filter(Boolean)
  )]
    .sort((a, b) => a.localeCompare(b))
    .map((worker) => ({ value: worker, label: worker }));
}

function getVisitLookup(state) {
  return new Map((state.visits || []).map((visit) => [visit.visit_id, visit]));
}

function getAssignedVisitIds(state, routeDate, workerValue) {
  if (!workerValue) return new Set();

  const assignedRouteVisitIds = (state.routes || [])
    .filter((route) => route.route_date === routeDate && (
      isProductionMode()
        ? route.employee_id === workerValue
        : route.assigned_worker === workerValue
    ))
    .flatMap((route) => route.visit_ids || []);

  const assignedVisitIds = (state.visits || [])
    .filter((visit) => !isProductionMode() && visit.visit_date === routeDate && visit.assigned_worker === workerValue)
    .map((visit) => visit.visit_id);

  return new Set([...assignedRouteVisitIds, ...assignedVisitIds]);
}

function visitMatchesCard(visit, cardText) {
  return cardText.includes(`Visit date ${visit.visit_date}`)
    && cardText.includes(visit.service_description || '')
    && cardText.includes(`Status: ${visit.status}`);
}

function applyWorkerFilter(section, state, workerValue) {
  const routeDate = getSelectedRouteDate(section);
  const assignedVisitIds = getAssignedVisitIds(state, routeDate, workerValue);
  const visitsById = getVisitLookup(state);
  const assignedVisits = [...assignedVisitIds].map((visitId) => visitsById.get(visitId)).filter(Boolean);

  section.querySelectorAll('article.panel').forEach((card) => {
    const cardText = card.textContent || '';
    const isVisitCard = cardText.includes('Visit date ') && cardText.includes('Status:');
    if (!isVisitCard) return;

    const shouldShow = !workerValue || assignedVisits.some((visit) => visitMatchesCard(visit, cardText));
    card.hidden = !shouldShow;
  });

  const existingEmpty = section.querySelector('[data-worker-route-empty]');
  if (existingEmpty) existingEmpty.remove();

  const visibleVisitCards = [...section.querySelectorAll('article.panel')]
    .filter((card) => !card.hidden && (card.textContent || '').includes('Visit date ') && (card.textContent || '').includes('Status:'));

  if (workerValue && visibleVisitCards.length === 0) {
    const worker = getAssignedWorkersForDate(state, routeDate).find((item) => item.value === workerValue);
    const emptyCard = document.createElement('article');
    emptyCard.className = 'panel';
    emptyCard.setAttribute('data-worker-route-empty', 'true');
    emptyCard.innerHTML = `<p>No assigned stops found for ${escapeHtml(worker?.label || workerValue)} on this date.</p>`;
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
          ${workers.map((worker) => `<option value="${escapeAttr(worker.value)}">${escapeHtml(worker.label)}</option>`).join('')}
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
