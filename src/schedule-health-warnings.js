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

function findPropertyForCard(card, state) {
  const heading = card.querySelector('h3')?.textContent.trim();
  if (!heading) return null;
  return (state.properties || []).find((property) => property.service_address === heading);
}

function hasUpcomingVisit(state, propertyId) {
  return (state.visits || []).some((visit) =>
    visit.property_id === propertyId
    && visit.status === 'scheduled'
    && visit.visit_date
    && visit.visit_date >= today()
  );
}

function addScheduleHealthWarnings() {
  const state = loadState();
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
    if (hasUpcomingVisit(state, property.property_id)) return;

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
