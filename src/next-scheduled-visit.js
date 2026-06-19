import {
  getNextScheduledVisitForProperty,
  getScheduledVisitsForProperty,
  getStateSnapshot
} from './data/repositories/visitReadRepository.js';
import { escapeHtml } from './utils/renderSecurity.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findPropertyForCard(card, state) {
  const heading = card.querySelector('h3')?.textContent.trim();
  if (!heading) return null;
  return (state.properties || []).find((property) => property.service_address === heading);
}

function getNextScheduledVisit(state, propertyId) {
  return getNextScheduledVisitForProperty(propertyId, today());
}

function getOverdueVisit(state, propertyId) {
  return getScheduledVisitsForProperty(propertyId)
    .filter((visit) => visit.visit_date < today())[0];
}

function addNextScheduledVisitIndicators() {
  const state = getStateSnapshot();
  if (!state) return;

  document.querySelectorAll('article.panel').forEach((card) => {
    if (card.querySelector('[data-next-scheduled-visit]')) return;

    const property = findPropertyForCard(card, state);
    if (!property) return;

    const existingPropertyClue = card.textContent.includes('Default Price:')
      || card.textContent.includes('Schedule Visit')
      || card.textContent.includes('Access Info');
    if (!existingPropertyClue) return;

    const overdueVisit = getOverdueVisit(state, property.property_id);
    const nextVisit = getNextScheduledVisit(state, property.property_id);

    const indicator = document.createElement('p');
    indicator.setAttribute('data-next-scheduled-visit', 'true');

    if (overdueVisit) {
      indicator.innerHTML = `<span class="badge overdue">⚠ Overdue since ${escapeHtml(overdueVisit.visit_date)}</span>`;
    } else if (nextVisit) {
      indicator.innerHTML = `<span class="badge paid-up">Next scheduled visit: ${escapeHtml(nextVisit.visit_date)}</span>`;
    } else {
      indicator.innerHTML = '<span class="badge outstanding">No upcoming visit scheduled</span>';
    }

    const serviceLine = [...card.querySelectorAll('p')]
      .find((line) => line.textContent.includes(property.service_type || ''));

    if (serviceLine) {
      serviceLine.insertAdjacentElement('afterend', indicator);
    } else {
      card.appendChild(indicator);
    }
  });
}

const observer = new MutationObserver(addNextScheduledVisitIndicators);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addNextScheduledVisitIndicators();
