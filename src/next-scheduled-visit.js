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

function getNextScheduledVisit(state, propertyId) {
  return (state.visits || [])
    .filter((visit) =>
      visit.property_id === propertyId
      && visit.status === 'scheduled'
      && visit.visit_date
      && visit.visit_date >= today()
    )
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date))[0];
}

function getOverdueVisit(state, propertyId) {
  return (state.visits || [])
    .filter((visit) =>
      visit.property_id === propertyId
      && visit.status === 'scheduled'
      && visit.visit_date
      && visit.visit_date < today()
    )
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date))[0];
}

function addNextScheduledVisitIndicators() {
  const state = loadState();
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
      indicator.innerHTML = `<span class="badge overdue">⚠ Overdue since ${overdueVisit.visit_date}</span>`;
    } else if (nextVisit) {
      indicator.innerHTML = `<span class="badge paid-up">Next scheduled visit: ${nextVisit.visit_date}</span>`;
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
