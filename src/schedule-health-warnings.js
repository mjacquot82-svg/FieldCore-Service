import {
  getStateSnapshot,
  hasUpcomingScheduledVisitForProperty
} from './data/repositories/visitReadRepository.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findPropertyForCard(card, state) {
  const heading = card.querySelector('h3')?.textContent.trim();
  if (!heading) return null;
  return (state.properties || []).find((property) => property.service_address === heading);
}

function addScheduleHealthWarnings() {
  const state = getStateSnapshot();
  if (!state) return;

  document.querySelectorAll('article.panel').forEach((card) => {
    if (card.querySelector('[data-schedule-health-warning]')) return;

    const property = findPropertyForCard(card, state);
    if (!property) return;

    const isPropertyCard = card.textContent.includes('Default Price:')
      || card.textContent.includes('Schedule Visit')
      || card.textContent.includes('Recurring Schedule');
    if (!isPropertyCard) return;

    const hasActiveRecurringSchedule = property.recurring_schedule?.status === 'active';
    if (!hasActiveRecurringSchedule) return;
    if (hasUpcomingScheduledVisitForProperty(property.property_id, today())) return;

    const warning = document.createElement('p');
    warning.setAttribute('data-schedule-health-warning', 'true');
    warning.innerHTML = '<span class="badge overdue">⚠ No upcoming visits generated</span>';

    const actions = card.querySelector('.actions');
    if (actions) {
      actions.insertAdjacentElement('beforebegin', warning);
    } else {
      card.appendChild(warning);
    }
  });
}

const observer = new MutationObserver(addScheduleHealthWarnings);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addScheduleHealthWarnings();
